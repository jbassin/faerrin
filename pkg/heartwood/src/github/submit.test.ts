import { test, expect, describe, beforeEach } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { submitOne } from './submit';
import type { SubmitCtx } from './submit';
import type { GitHubClient } from './client';
import type { Ledger, LedgerEntry } from '../transcript/ledger';
import { EMPTY_STAGES, readLedger } from '../transcript/ledger';
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
function makeMockClient(overrides: Partial<GitHubClient> = {}): { client: GitHubClient; calls: string[] } {
  const calls: string[] = [];
  const client: GitHubClient = {
    getProject: async () => {
      calls.push('getProject');
      return { defaultBranch: 'main', webUrl: 'https://github.com/ns/proj' };
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
      return 'head-sha';
    },
    createPullRequest: async (opts) => {
      calls.push(`createPullRequest:${opts.headBranch}`);
      return { number: 1, webUrl: 'https://github.com/ns/proj/pull/1' };
    },
    createReviewComment: async (prNumber, _opts) => {
      const id = `disc-${_discId++}`;
      calls.push(`createReviewComment:${prNumber}:${id}`);
      return { discussionId: id };
    },
    listDiscussions: async (_prNumber) => [],
    addDiscussionNote: async (prNumber, discussionId, _body) => {
      calls.push(`addDiscussionNote:${prNumber}:${discussionId}`);
    },
    addIssueComment: async (prNumber, _body) => {
      calls.push(`addIssueComment:${prNumber}`);
    },
    ...overrides,
  };
  return { client, calls };
}

const EDIT = (path = 'Geography/Hallia/index.md'): Proposal =>
  ({ kind: 'edit', path, oldText: 'Old text.', newText: 'New text.', citations: [[10, 10]] });

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

  function makeCtx(clientFn: () => GitHubClient, dryRun = false): SubmitCtx {
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

  test('calls getProject, branchExists, createBranch, commitFiles, createPullRequest in order', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    await writeProposalsFile(proposalsDir, filename, [EDIT()]);

    const { client, calls } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    expect(calls[0]).toBe('getProject');
    expect(calls[1]).toBe(`branchExists:wiki/000.through-a-song-darkly.2025-8-28`);
    expect(calls[2]).toBe(`createBranch:wiki/000.through-a-song-darkly.2025-8-28:main`);
    expect(calls[3]).toBe(`commitFiles:wiki/000.through-a-song-darkly.2025-8-28`);
    expect(calls[4]).toBe(`createPullRequest:wiki/000.through-a-song-darkly.2025-8-28`);
  });

  test('branch collision: tries wiki/foo-2 when wiki/foo exists', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    await writeProposalsFile(proposalsDir, filename, [EDIT()]);

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

    await writeProposalsFile(proposalsDir, filename, []);

    const { client } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.stages.verified).not.toBeNull();
    expect(updatedEntry.stages.prOpened).not.toBeNull();
    expect(updatedEntry.prUrl).toBe('https://github.com/ns/proj/pull/1');
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
    await writeProposalsFile(proposalsDir, filename, [EDIT()]);

    const { client } = makeMockClient({
      commitFiles: async () => { throw new Error('GitHub API error: 500'); },
    });

    await expect(submitOne(entry, ledger, makeCtx(() => client))).rejects.toThrow('GitHub API error');

    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.stages.prOpened).toBeNull();
    expect(updatedEntry.errors.some((e) => e.stage === 'prOpened')).toBe(true);
  });

  test('createReviewComment called once per CommentProposal when an edit carries the diff', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      EDIT(),
      { kind: 'comment', reason: 'speculative', relatedPath: 'Geography/Hallia/index.md', message: 'Speculative.', citations: [[5, 5]] },
      { kind: 'comment', reason: 'contradict', relatedPath: null, message: 'Contradiction.', citations: [[10, 12]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client, calls } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const reviewCalls = calls.filter((c) => c.startsWith('createReviewComment:'));
    expect(reviewCalls).toHaveLength(2);
  });

  test('a rejected review comment (422) is folded into a PR-level comment and does not abort submit', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      EDIT(),
      { kind: 'comment', reason: 'speculative', relatedPath: 'Geography/Hallia/index.md', message: 'Spec.', citations: [[5, 5]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    let issueCommentBody = '';
    const { client } = makeMockClient({
      createReviewComment: async () => { throw new Error('GitHub API POST /pulls/1/comments failed (422): line must be part of the diff'); },
      addIssueComment: async (_n, body) => { issueCommentBody = body; },
    });

    // Must NOT throw despite the 422.
    await submitOne(entry, ledger, makeCtx(() => client));

    // Rejected note folded into the PR-level comment.
    expect(issueCommentBody).toContain('## Flagged for Review');
    expect(issueCommentBody).toContain('Spec.');

    // PR still recorded in the ledger (not orphaned).
    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.stages.prOpened).not.toBeNull();
    expect(updatedEntry.prNumber).toBe(1);

    // No tracked discussions, since the inline comment didn't anchor.
    const sub = JSON.parse(await Bun.file(`${submissionsDir}/000.through-a-song-darkly.2025-8-28.json`).text());
    expect(sub.discussions).toHaveLength(0);
  });

  test('review comments are anchored to the first non-delete file at line 1 on the head sha', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      EDIT(),
      { kind: 'comment', reason: 'speculative', relatedPath: 'Geography/Hallia/index.md', message: 'Spec.', citations: [[5, 5]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const anchors: Array<{ commitId: string; path: string; line: number }> = [];
    const { client } = makeMockClient({
      createReviewComment: async (_n, opts) => {
        anchors.push({ commitId: opts.commitId, path: opts.path, line: opts.line });
        return { discussionId: 'd0' };
      },
    });
    await submitOne(entry, ledger, makeCtx(() => client));

    expect(anchors[0]).toEqual({ commitId: 'head-sha', path: 'content/Geography/Hallia/index.md', line: 1 });
  });

  test('only-comments (no edits) → no review comments; comments folded into PR body under "Flagged for Review"', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    const proposals: Proposal[] = [
      { kind: 'comment', reason: 'speculative', relatedPath: 'Org/Foo/index.md', message: 'Spec msg.', citations: [[1, 2]] },
      { kind: 'comment', reason: 'contradict', relatedPath: null, message: 'Contra msg.', citations: [[3, 3]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    let capturedBody = '';
    const { client, calls } = makeMockClient({
      createPullRequest: async (opts) => {
        capturedBody = opts.body;
        return { number: 1, webUrl: 'https://github.com/ns/proj/pull/1' };
      },
    });
    await submitOne(entry, ledger, makeCtx(() => client));

    expect(calls.filter((c) => c.startsWith('createReviewComment:'))).toHaveLength(0);
    expect(capturedBody).toContain('## Flagged for Review');
    expect(capturedBody).toContain('Spec msg.');
    expect(capturedBody).toContain('Contra msg.');

    // No discussions tracked when folded into the body.
    const sub = JSON.parse(await Bun.file(`${submissionsDir}/000.through-a-song-darkly.2025-8-28.json`).text());
    expect(sub.discussions).toHaveLength(0);
  });

  test('submissions file written with prNumber, branch, and discussion mappings', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      EDIT(),
      { kind: 'comment', reason: 'speculative', relatedPath: null, message: 'Spec.', citations: [[1, 1]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const { client } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const basename = '000.through-a-song-darkly.2025-8-28';
    const subFile = Bun.file(`${submissionsDir}/${basename}.json`);
    expect(await subFile.exists()).toBe(true);
    const sub = JSON.parse(await subFile.text());
    expect(sub.prNumber).toBe(1);
    expect(sub.branch).toBe(`wiki/${basename}`);
    expect(sub.discussions).toHaveLength(1);
    expect(sub.discussions[0].proposalIndex).toBe(1);
    expect(typeof sub.discussions[0].discussionId).toBe('string');
  });

  test('prNumber written to ledger on success', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeProposalsFile(proposalsDir, filename, []);
    const { client } = makeMockClient();
    await submitOne(entry, ledger, makeCtx(() => client));

    const updated = await readLedger(ledgerPath);
    const updatedEntry = updated.entries.find((e) => e.filename === filename)!;
    expect(updatedEntry.prNumber).toBe(1);
  });

  test('PR title is title-cased campaign name + session date', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeProposalsFile(proposalsDir, filename, []);

    let capturedTitle = '';
    const { client } = makeMockClient({
      createPullRequest: async (opts) => {
        capturedTitle = opts.title;
        return { number: 1, webUrl: 'https://github.com/ns/proj/pull/1' };
      },
    });

    await submitOne(entry, ledger, makeCtx(() => client));
    expect(capturedTitle).toBe('Wiki: Through A Song Darkly 2025-08-28');
  });

  test('review comment body includes [Speculative] / [Contradiction] prefix and (no related page) when relatedPath null', async () => {
    const filename = '000.through-a-song-darkly.2025-8-28.txt';
    const entry = makeEntry(filename);
    const ledger = makeLedger(entry);

    await writeContentFile(contentDir, 'Geography/Hallia/index.md', '# Hallia\n\nOld text.\n');
    const proposals: Proposal[] = [
      EDIT(),
      { kind: 'comment', reason: 'speculative', relatedPath: 'Org/Foo/index.md', message: 'Spec msg.', citations: [[1, 2]] },
      { kind: 'comment', reason: 'contradict', relatedPath: null, message: 'Contra msg.', citations: [[3, 3]] },
    ];
    await writeProposalsFile(proposalsDir, filename, proposals);

    const noteBodies: string[] = [];
    const { client } = makeMockClient({
      createReviewComment: async (_n, opts) => {
        noteBodies.push(opts.body);
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
      commitFiles: async (_, _actions, message) => { capturedMessage = message; return 'head-sha'; },
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
    const descExists        = await Bun.file(`${tmpDir}/dry-runs/${basename}/pr-description.md`).exists();
    const notesExists       = await Bun.file(`${tmpDir}/dry-runs/${basename}/notes.json`).exists();
    const discussionsExists = await Bun.file(`${tmpDir}/dry-runs/${basename}/discussions.json`).exists();
    expect(changesExists).toBe(true);
    expect(descExists).toBe(true);
    expect(notesExists).toBe(true);
    expect(discussionsExists).toBe(true);

    const resultEntry = result.entries.find((e) => e.filename === filename)!;
    expect(resultEntry.stages.prOpened).toBeNull();
  });
});
