import { test, expect, describe, beforeEach } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { respondOne, type RespondCtx } from './respond';
import type { GitLabClient, Discussion } from './client';
import type { LedgerEntry } from '../transcript/ledger';
import { EMPTY_STAGES } from '../transcript/ledger';
import type { SubmissionsFile } from './submissions';
import { writeSubmissions } from './submissions';

// ---- Helpers ----

async function makeTmpDir(): Promise<string> {
  const dir = `/tmp/heartwood-respond-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(dir, { recursive: true });
  return dir;
}

function makeEntry(filename: string, prOpened = true): LedgerEntry {
  return {
    filename,
    contentHash: 'abc123',
    stages: {
      ...EMPTY_STAGES,
      proposed:  '2025-01-01T00:00:00Z',
      verified:  '2025-01-02T00:00:00Z',
      prOpened:  prOpened ? '2025-01-03T00:00:00Z' : null,
    },
    errors: [],
    mrIid: 1,
  };
}

function makeDiscussion(
  id: string,
  notes: Array<{ body: string; position?: Discussion['notes'][0]['position'] }>,
): Discussion {
  return {
    id,
    individual_note: false,
    notes: notes.map((n, i) => ({
      id: i,
      body: n.body,
      author: { username: i === 0 ? 'bot' : 'reviewer' },
      position: n.position ?? null,
    })),
  };
}

function makeDiffDiscussion(id: string, instruction: string, filePath: string): Discussion {
  return {
    id,
    individual_note: false,
    notes: [{
      id: 0,
      body: instruction,
      author: { username: 'reviewer' },
      position: {
        position_type: 'text',
        new_path: filePath,
        new_line: 1,
        old_line: null,
      },
    }],
  };
}

async function writeProposalsFile(dir: string, filename: string, proposals: unknown[]) {
  await Bun.write(`${dir}/${filename}.json`, JSON.stringify({
    filename, contentHash: 'abc123', proposals,
  }));
}

function makeMockClient(
  discussions: Discussion[] = [],
  overrides: Partial<GitLabClient> = {},
): { client: GitLabClient; committed: Array<{ branch: string; actions: unknown[]; message: string }>; replies: Array<{ discussionId: string; body: string }> } {
  const committed: Array<{ branch: string; actions: unknown[]; message: string }> = [];
  const replies: Array<{ discussionId: string; body: string }> = [];

  const client: GitLabClient = {
    getProject: async () => ({ defaultBranch: 'main', webUrl: 'https://example.com' }),
    branchExists: async () => false,
    createBranch: async () => {},
    commitFiles: async (branch, actions, message) => { committed.push({ branch, actions, message }); },
    createMergeRequest: async () => ({ iid: 1, webUrl: 'https://example.com/mr/1' }),
    createDiscussion: async () => ({ discussionId: 'disc-0' }),
    listDiscussions: async () => discussions,
    addDiscussionNote: async (_mrIid, discussionId, body) => { replies.push({ discussionId, body }); },
    ...overrides,
  };
  return { client, committed, replies };
}

function makeCtx(
  tmpDir: string,
  client: GitLabClient,
  completeFn?: RespondCtx['completeFn'],
): RespondCtx {
  return {
    ledgerPath:      `${tmpDir}/processed.json`,
    submissionsDir:  `${tmpDir}/submissions`,
    proposalsDir:    `${tmpDir}/proposals`,
    contentDir:      `${tmpDir}/content`,
    transcriptsDir:  `${tmpDir}/transcripts`,
    conventionsPath: `${tmpDir}/CLAUDE.md`,
    clientFn:        () => client,
    completeFn,
  };
}

async function writeDefaultSub(dir: string, filename: string, discussions: SubmissionsFile['discussions'] = []) {
  const basename = filename.endsWith('.txt') ? filename.slice(0, -4) : filename;
  await writeSubmissions(`${dir}/submissions/${basename}.json`, {
    filename,
    mrIid: 1,
    branch: `wiki/${basename}`,
    discussions,
  });
}

// ---- Tests ----

describe('respondOne — guards', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    await mkdir(`${tmpDir}/submissions`, { recursive: true });
    await mkdir(`${tmpDir}/proposals`,   { recursive: true });
    await mkdir(`${tmpDir}/content`,     { recursive: true });
  });

  test('throws when prOpened is null', async () => {
    const entry = makeEntry('000.test.2025-1-1.txt', false);
    const { client } = makeMockClient();
    await expect(respondOne(entry, makeCtx(tmpDir, client))).rejects.toThrow('MR not opened');
  });

  test('throws when submissions file is missing', async () => {
    const entry = makeEntry('000.test.2025-1-1.txt');
    const { client } = makeMockClient();
    await expect(respondOne(entry, makeCtx(tmpDir, client))).rejects.toThrow('submissions file missing');
  });
});

describe('respondOne — tracked discussions', () => {
  const FILENAME = '000.test.2025-1-1.txt';
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    await mkdir(`${tmpDir}/submissions`, { recursive: true });
    await mkdir(`${tmpDir}/proposals`,   { recursive: true });
    await mkdir(`${tmpDir}/content`,     { recursive: true });
    await Bun.write(`${tmpDir}/CLAUDE.md`, '## Content Files\nStub conventions.\n\n---\n\nDefault to using Bun\n');
  });

  test('no reply → no commit, no discussion note posted', async () => {
    const disc = makeDiscussion('disc-1', [{ body: '**[Speculative]** — `content/Foo.md`\n\nClaim.' }]);
    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client));

    expect(committed).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  test('deny reply → no commit, "Denied." note posted', async () => {
    const disc = makeDiscussion('disc-1', [
      { body: '**[Speculative]**' },
      { body: 'deny this' },
    ]);
    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client));

    expect(committed).toHaveLength(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.body).toBe('Denied — no changes applied.');
    expect(replies[0]!.discussionId).toBe('disc-1');
  });

  test('approve reply → LLM called, commit made, "Applied." posted', async () => {
    const disc = makeDiscussion('disc-1', [
      { body: '**[Speculative]**' },
      { body: 'approve' },
    ]);

    const mockComplete: RespondCtx['completeFn'] = async (args) => {
      expect(args.stage).toBe('respond-approve');
      return {
        text: '',
        usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
        value: {
          proposal: {
            kind: 'append', afterHeading: null,
            content: 'New info.',
            citations: [[1, 1]],
          },
        },
      } as Awaited<ReturnType<typeof defaultComplete>>;
    };

    await Bun.write(`${tmpDir}/content/Foo.md`, '# Foo\n\nExisting content.\n');

    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client, mockComplete));

    expect(committed).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.body).toBe('Applied.');
    expect(replies[0]!.discussionId).toBe('disc-1');
  });

  test('"Approve" with capital A is accepted (case-insensitive)', async () => {
    const disc = makeDiscussion('disc-1', [
      { body: '**[Speculative]**' },
      { body: 'Approve this, please' },
    ]);

    const mockComplete: RespondCtx['completeFn'] = async () => ({
      text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
      value: { proposal: { kind: 'append', afterHeading: null, content: 'x', citations: [[1, 1]] } },
    } as never);

    await Bun.write(`${tmpDir}/content/Foo.md`, '# Foo\n');

    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client, mockComplete));

    expect(committed).toHaveLength(1);
    expect(replies[0]!.body).toBe('Applied.');
  });

  test('discussion already has "Applied." → skipped entirely', async () => {
    const disc = makeDiscussion('disc-1', [
      { body: '**[Speculative]**' },
      { body: 'approve' },
      { body: 'Applied.' },
    ]);
    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client));

    expect(committed).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  test('discussion already has "Denied." → skipped', async () => {
    const disc = makeDiscussion('disc-1', [
      { body: '**[Speculative]**' },
      { body: 'deny' },
      { body: 'Denied — no changes applied.' },
    ]);
    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client));

    expect(committed).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
});

describe('respondOne — diff discussions', () => {
  const FILENAME = '000.test.2025-1-1.txt';
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    await mkdir(`${tmpDir}/submissions`, { recursive: true });
    await mkdir(`${tmpDir}/proposals`,   { recursive: true });
    await mkdir(`${tmpDir}/content`,     { recursive: true });
  });

  test('diff discussion → LLM called, commit made, "Applied." posted', async () => {
    const disc = makeDiffDiscussion('diff-1', 'delete this entry', 'content/Old.md');
    await Bun.write(`${tmpDir}/content/Old.md`, '# Old\n\nContent.\n');

    const mockComplete: RespondCtx['completeFn'] = async (args) => {
      expect(args.stage).toBe('respond-diff');
      return {
        text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
        value: { actions: [{ action: 'delete', filePath: 'content/Old.md' }] },
      } as never;
    };

    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, []);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client, mockComplete));

    expect(committed).toHaveLength(1);
    expect(committed[0]!.actions).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.body).toBe('Applied.');
    expect(replies[0]!.discussionId).toBe('diff-1');
  });

  test('diff discussion already has "Applied." → skipped', async () => {
    const disc: Discussion = {
      id: 'diff-1',
      individual_note: false,
      notes: [
        {
          id: 0, body: 'delete this', author: { username: 'reviewer' },
          position: { position_type: 'text', new_path: 'content/Old.md', new_line: 1, old_line: null },
        },
        { id: 1, body: 'Applied.', author: { username: 'bot' }, position: null },
      ],
    };

    const { client, committed, replies } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, []);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client));

    expect(committed).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  test('tracked discussion IDs are excluded from diff discussion processing', async () => {
    // A discussion that is both tracked AND has a position (edge case)
    const disc: Discussion = {
      id: 'tracked-1',
      individual_note: false,
      notes: [{
        id: 0, body: '**[Speculative]**', author: { username: 'bot' },
        position: { position_type: 'text', new_path: 'content/Foo.md', new_line: 1, old_line: null },
      }],
    };

    let llmCalled = false;
    const mockComplete: RespondCtx['completeFn'] = async () => {
      llmCalled = true;
      return { text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 }, value: { actions: [] } } as never;
    };

    const { client } = makeMockClient([disc]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'tracked-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client, mockComplete));

    // No approve reply → no LLM call; tracked so not treated as diff
    expect(llmCalled).toBe(false);
  });
});

describe('respondOne — batching', () => {
  const FILENAME = '000.test.2025-1-1.txt';
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    await mkdir(`${tmpDir}/submissions`, { recursive: true });
    await mkdir(`${tmpDir}/proposals`,   { recursive: true });
    await mkdir(`${tmpDir}/content`,     { recursive: true });
    await Bun.write(`${tmpDir}/CLAUDE.md`, '## Content Files\nStub conventions.\n\n---\n\nDefault to using Bun\n');
  });

  test('multiple approvals produce a single commit', async () => {
    const disc1 = makeDiscussion('disc-1', [{ body: '**[Speculative]**' }, { body: 'approve' }]);
    const disc2 = makeDiffDiscussion('diff-1', 'delete this', 'content/Old.md');

    await Bun.write(`${tmpDir}/content/Foo.md`, '# Foo\n\nExisting.\n');
    await Bun.write(`${tmpDir}/content/Old.md`, '# Old\n');

    const mockComplete: RespondCtx['completeFn'] = async (args) => {
      if (args.stage === 'respond-approve') {
        return {
          text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
          value: { proposal: { kind: 'append', afterHeading: null, content: 'Info.', citations: [[1, 1]] } },
        } as never;
      }
      return {
        text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
        value: { actions: [{ action: 'delete', filePath: 'content/Old.md' }] },
      } as never;
    };

    const { client, committed, replies } = makeMockClient([disc1, disc2]);
    await writeDefaultSub(tmpDir, FILENAME, [{ discussionId: 'disc-1', proposalIndex: 0 }]);
    await writeProposalsFile(`${tmpDir}/proposals`, FILENAME, [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Foo.md', message: 'Claim.', citations: [[1, 1]] },
    ]);

    await respondOne(makeEntry(FILENAME), makeCtx(tmpDir, client, mockComplete));

    expect(committed).toHaveLength(1);    // single batched commit
    expect(committed[0]!.actions).toHaveLength(2);
    expect(replies).toHaveLength(2);      // one per handled discussion
  });
});

// Needed for type narrowing in mockComplete above
import type { complete as defaultComplete } from '../llm';
