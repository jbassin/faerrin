import { test, expect, describe, beforeEach } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { submitOne } from './submit';
import type { SubmitCtx } from './submit';
import type { GitLabClient, CommitAction } from './client';
import type { Ledger, LedgerEntry } from '../transcript/ledger';
import { emptyLedger, EMPTY_STAGES, readLedger } from '../transcript/ledger';
import type { Proposal } from '../reconcile/propose';

// ---- helpers ----

async function makeTmpDir(): Promise<string> {
  const dir = `/tmp/heartwood-submit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(dir, { recursive: true });
  return dir;
}

function makeEntry(filename: string, contentHash = 'abc123'): LedgerEntry {
  return { filename, contentHash, stages: { ...EMPTY_STAGES, proposed: '2025-01-01T00:00:00Z' }, errors: [] };
}

function makeLedger(...entries: LedgerEntry[]): Ledger {
  return { entries };
}

async function writeProposalsFile(dir: string, filename: string, proposals: Proposal[], contentHash = 'abc123') {
  const payload = {
    filename,
    contentHash,
    matchesContentHash: contentHash,
    stats: {
      totalClusters: proposals.length,
      updateClusters: 0, createClusters: 0, aliasEditClusters: 0, commentClusters: 0,
      proposalsByKind: { edit: 0, append: 0, create: 0, comment: 0 },
      droppedByReason: {},
      llmCalls: 0,
    },
    proposals,
  };
  // Update proposalsByKind stats
  for (const p of proposals) {
    const kinds = payload.stats.proposalsByKind as Record<string, number>;
    kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
  }
  await Bun.write(`${dir}/${filename}.json`, JSON.stringify(payload, null, 2));
}

async function writeContentFile(dir: string, relPath: string, content: string) {
  const parts = relPath.split('/');
  const subDir = [dir, ...parts.slice(0, -1)].join('/');
  await mkdir(subDir, { recursive: true });
  await Bun.write(`${dir}/${relPath}`, content);
}

let _discId = 0;
function makeMockClient(overrides: Partial<GitLabClient> = {}): { client: GitLabClient; calls: string[] } {
  const calls: string[] = [];
  const client: GitLabClient = {
    getProject: async () => {
      calls.push('getProject');
      return { defaultBranch: 'main', webUrl: 'https://gitlab.example.com/ns/proj' };
    },
    branchExists: async (name) => {
      calls.push(`branchExists:${name}`);
      return false;
    },
    createBranch: async (name, from) => {
      calls.push(`createBranch:${name}:${from}`);
    },
    commitFiles: async (branch, _actions, _message) => {
      calls.push(`commitFiles:${branch}`);
    },
    createMergeRequest: async (opts) => {
      calls.push(`createMergeRequest:${opts.sourceBranch}`);
      return { iid: 1, webUrl: 'https://gitlab.example.com/ns/proj/-/merge_requests/1' };
    },
    createDiscussion: async (mrIid, _body) => {
      const id = `disc-${_discId++}`;
      calls.push(`createDiscussion:${mrIid}:${id}`);
      return { discussionId: id };
    },
    listDiscussions: async (_mrIid) => [],
    addDiscussionNote: async (mrIid, discussionId, _body) => {
      calls.push(`addDiscussionNote:${mrIid}:${discussionId}`);
    },
    ...overrides,
  };
  return { client, calls };
}

// ---- tests ----

describe('submitOne — live path', () => {
  let tmpDir: string;
  let ledgerPath: string;
  let proposalsDir: string;
  let contentDir: string;
  let dryRunsDir: string;
  let submissionsDir: string;

  beforeEach(async () => {
    _discId = 0;
    tmpDir = await makeTmpDir();
    ledgerPath    = `${tmpDir}/processed.json`;
    proposalsDir  = `${tmpDir}/proposals`;
    contentDir    = `${tmpDir}/content`;
    dryRunsDir    = `${tmpDir}/dry-runs`;
    submissionsDir = `${tmpDir}/submissions`;
    await mkdir(proposalsDir,   { recursive: true });
    await mkdir(contentDir,     { recursive: true });
    await mkdir(dryRunsDir,     { recursive: true });
    await mkdir(submissionsDir, { recursive: true });
  });

  function makeCtx(clientFn: () => GitLabClient, dryRun = false): SubmitCtx {
    return {
      transcriptsDir: `${tmpDir}/transcripts`,
      ledgerPath,
      proposalsDir,
      contentDir,
      dryRunsDir,
      submissionsDir,
      dryRun,
      clientFn: () => clientFn(),
    };
  }

  test('calls getProject, branchExists, createBranch, commitFiles, createMergeRequest in order', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      { kind: 'edit', path: 'Geography/Hallia/index.md', oldText: 'Old text.', newText: 'New text.', citations: [[10, 10]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client, calls } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    expect(calls[0]).toBe('getProject');
    expect(calls[1]).toBe(`branchExists:wiki/000.through-a-song-darkly.2025-8-28`);
    expect(calls[2]).toBe(`createBranch:wiki/000.through-a-song-darkly.2025-8-28:main`);
    expect(calls[3]).toBe(`commitFiles:wiki/000.through-a-song-darkly.2025-8-28`);
    expect(calls[4]).toBe(`createMergeRequest:wiki/000.through-a-song-darkly.2025-8-28`);
  });

  test('branch collision: tries wiki/foo-2 when wiki/foo exists', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      { kind: 'edit', path: 'Geography/Hallia/index.md', oldText: 'Old text.', newText: 'New text.', citations: [[10, 10]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client, calls } = makeMockClient({
      branchExists: async (name) => {
        calls.push(`branchExists:${name}`);
        return name === 'wiki/000.through-a-song-darkly.2025-8-28';
      },
      createBranch: async (name) => {
        calls.push(`createBranch:${name}`);
      },
    });

    await submitOne(entry, ledger, makeCtx(() => client));
    expect(calls).toContain('branchExists:wiki/000.through-a-song-darkly.2025-8-28-2');
    expect(calls.find((c) => c.startsWith('createBranch:'))).toBe(
      'createBranch:wiki/000.through-a-song-darkly.2025-8-28-2',
    );
  });

  test('ledger has verified, prOpened, and prUrl set on success', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const proposals: Proposal[] = [];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.stages.verified).not.toBeNull();
    expect(updatedEntry.stages.prOpened).not.toBeNull();
    expect(updatedEntry.prUrl).toBe('https://gitlab.example.com/ns/proj/-/merge_requests/1');
  });

  test('stale proposals (contentHash mismatch) → throws without calling any client methods', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename, 'correct-hash');
    const ledger = makeLedger(entry);

    await writeProposalsFile(proposalsDir, filename, [], 'stale-hash');

    const { client, calls } = makeMockClient();
    await expect(submitOne(entry, ledger, makeCtx(() => client))).rejects.toThrow('transcript changed');
    expect(calls).toHaveLength(0);
  });

  test('missing proposals file → throws without calling any client methods', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const { client, calls } = makeMockClient();
    await expect(submitOne(entry, ledger, makeCtx(() => client))).rejects.toThrow('proposals file missing');
    expect(calls).toHaveLength(0);
  });

  test('client error on commitFiles → error recorded in ledger, stage not set', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      { kind: 'edit', path: 'Geography/Hallia/index.md', oldText: 'Old text.', newText: 'New text.', citations: [[10, 10]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client } = makeMockClient({
      commitFiles: async () => { throw new Error('GitLab API error: 500'); },
    });

    await expect(submitOne(entry, ledger, makeCtx(() => client))).rejects.toThrow('GitLab API error');

    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.stages.prOpened).toBeNull();
    expect(updatedEntry.errors.some((e) => e.stage === 'prOpened')).toBe(true);
  });

  test('createDiscussion called once per CommentProposal', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const proposals: Proposal[] = [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Geography/Hallia/index.md', message: 'Speculative.', citations: [[5, 5]] },
      { kind: 'comment', reason: 'contradict', relatedPath: null, message: 'Contradiction.', citations: [[10, 12]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client, calls } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const discCalls = calls.filter((c) => c.startsWith('createDiscussion:'));
    expect(discCalls).toHaveLength(2);
  });

  test('submissions file written with mrIid, branch, and discussion mappings', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const proposals: Proposal[] = [
      { kind: 'comment', reason: 'speculative', relatedPath: null, message: 'Spec.', citations: [[1, 1]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const basename = '000.through-a-song-darkly.2025-8-28';
    const subFile = Bun.file(`${submissionsDir}/${basename}.json`);
    expect(await subFile.exists()).toBe(true);
    const sub = JSON.parse(await subFile.text());
    expect(sub.mrIid).toBe(1);
    expect(sub.branch).toBe(`wiki/${basename}`);
    expect(sub.discussions).toHaveLength(1);
    expect(sub.discussions[0].proposalIndex).toBe(0);
    expect(typeof sub.discussions[0].discussionId).toBe('string');
  });

  test('mrIid written to ledger on success', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeProposalsFile(proposalsDir, filename, []);
    const { client } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.mrIid).toBe(1);
  });

  test('MR title is title-cased campaign name + session date', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeProposalsFile(proposalsDir, filename, []);

    let capturedTitle = '';
    const { client } = makeMockClient({
      createMergeRequest: async (opts) => {
        capturedTitle = opts.title;
        return { iid: 1, webUrl: 'https://gitlab.example.com/ns/proj/-/merge_requests/1' };
      },
    });

    await submitOne(entry, ledger, makeCtx(() => client));
    expect(capturedTitle).toBe('Wiki: Through A Song Darkly 2025-08-28');
  });

  test('discussion body includes [Speculative] / [Contradiction] prefix and (no related page) when relatedPath null', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const proposals: Proposal[] = [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Org/Foo/index.md', message: 'Spec msg.', citations: [[1, 2]] },
      { kind: 'comment', reason: 'contradict', relatedPath: null, message: 'Contra msg.', citations: [[3, 3]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const noteBodies: string[] = [];
    const { client } = makeMockClient({
      createDiscussion: async (_mrIid, body) => {
        noteBodies.push(body);
        return { discussionId: `disc-${noteBodies.length - 1}` };
      },
    });

    await submitOne(entry, ledger, makeCtx(() => client));

    expect(noteBodies[0]).toContain('**[Speculative]**');
    expect(noteBodies[0]).toContain('`content/Org/Foo/index.md`');
    expect(noteBodies[0]).toContain('Spec msg.');
    expect(noteBodies[1]).toContain('**[Contradiction]**');
    expect(noteBodies[1]).toContain('(no related page)');
  });

  test('commit message includes one line per changed file with citation ranges', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      { kind: 'edit', path: 'Geography/Hallia/index.md', oldText: 'Old text.', newText: 'New text.', citations: [[10, 15], [20, 20]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    let capturedMessage = '';
    const { client } = makeMockClient({
      commitFiles: async (_, _actions, message) => { capturedMessage = message; },
    });

    await submitOne(entry, ledger, makeCtx(() => client));
    expect(capturedMessage).toContain('wiki: integrate 000.through-a-song-darkly.2025-8-28');
    expect(capturedMessage).toContain('content/Geography/Hallia/index.md');
    expect(capturedMessage).toContain('lines 10–20');
  });
});

describe('submitOne — dry-run path', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    await mkdir(`${tmpDir}/proposals`,    { recursive: true });
    await mkdir(`${tmpDir}/content`,      { recursive: true });
    await mkdir(`${tmpDir}/dry-runs`,     { recursive: true });
    await mkdir(`${tmpDir}/submissions`,  { recursive: true });
  });

  test('no client calls made, output files written to dryRunsDir', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const proposals: Proposal[] = [
      { kind: 'comment', reason: 'speculative', relatedPath: null, message: 'Maybe.', citations: [[1, 1]] },
    ];
    await writeProposalsFile(`${tmpDir}/proposals`, filename, proposals);

    const { client, calls } = makeMockClient();

    const ctx: SubmitCtx = {
      transcriptsDir: `${tmpDir}/transcripts`,
      ledgerPath:     `${tmpDir}/processed.json`,
      proposalsDir:   `${tmpDir}/proposals`,
      contentDir:     `${tmpDir}/content`,
      dryRunsDir:     `${tmpDir}/dry-runs`,
      submissionsDir: `${tmpDir}/submissions`,
      dryRun:         true,
      clientFn:       () => client,
    };

    const result = await submitOne(entry, ledger, ctx);
    expect(calls).toHaveLength(0);

    const basename = '000.through-a-song-darkly.2025-8-28';
    const changesExists     = await Bun.file(`${tmpDir}/dry-runs/${basename}/changes.json`).exists();
    const descExists        = await Bun.file(`${tmpDir}/dry-runs/${basename}/mr-description.md`).exists();
    const notesExists       = await Bun.file(`${tmpDir}/dry-runs/${basename}/notes.json`).exists();
    const discussionsExists = await Bun.file(`${tmpDir}/dry-runs/${basename}/discussions.json`).exists();
    expect(changesExists).toBe(true);
    expect(descExists).toBe(true);
    expect(notesExists).toBe(true);
    expect(discussionsExists).toBe(true);

    // Ledger unchanged (stages not set)
    const resultEntry = result.entries.find((e) => e.filename === filename)!;
    expect(resultEntry.stages.prOpened).toBeNull();
  });
});
