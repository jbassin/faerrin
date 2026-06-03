import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submit } from './submit';
import { readLedger, writeLedger, markStage, emptyLedger } from '../transcript/ledger';
import type { GitLabClient } from '../gitlab/client';

// ---- Helpers ----

interface Setup {
  root:           string;
  transcriptsDir: string;
  ledgerPath:     string;
  proposalsDir:   string;
  contentDir:     string;
  dryRunsDir:     string;
  submissionsDir: string;
}

function setup(transcriptNames: string[] = ['000.alpha.2025-8-28.txt']): Setup {
  const root           = mkdtempSync(join(tmpdir(), 'submit-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const proposalsDir   = join(root, 'proposals');
  const contentDir     = join(root, 'content');
  const dryRunsDir     = join(root, 'dry-runs');
  const submissionsDir = join(root, 'submissions');

  mkdirSync(transcriptsDir);
  mkdirSync(proposalsDir);
  mkdirSync(contentDir,     { recursive: true });
  mkdirSync(dryRunsDir,     { recursive: true });
  mkdirSync(submissionsDir, { recursive: true });

  for (const name of transcriptNames) {
    writeFileSync(join(transcriptsDir, name), 'line content\n');
  }

  return {
    root,
    transcriptsDir,
    ledgerPath: join(root, 'processed.json'),
    proposalsDir,
    contentDir,
    dryRunsDir,
    submissionsDir,
  };
}

function teardown(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

async function hashFile(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes();
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

async function populateProposals(
  s: Setup,
  filename: string,
  proposals: object[] = [],
): Promise<void> {
  const contentHash = await hashFile(join(s.transcriptsDir, filename));
  let ledger = await readLedger(s.ledgerPath);
  // If ledger is empty we still need the entry to exist (submit reconciles on its own)
  // Just pre-write proposals file.
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
  writeFileSync(join(s.proposalsDir, `${filename}.json`), JSON.stringify(payload, null, 2));
}

function makeNoopClient(): GitLabClient {
  return {
    getProject:          async () => ({ defaultBranch: 'main', webUrl: 'https://gitlab.example.com/ns/proj' }),
    branchExists:        async () => false,
    createBranch:        async () => {},
    commitFiles:         async () => {},
    createMergeRequest:  async () => ({ iid: 1, webUrl: 'https://gitlab.example.com/ns/proj/-/merge_requests/1' }),
    createDiscussion:    async () => ({ discussionId: 'disc-0' }),
    listDiscussions:     async () => [],
    addDiscussionNote:   async () => {},
  };
}

function makeOpts(s: Setup, extraOpts: object = {}) {
  return {
    transcriptsDir: s.transcriptsDir,
    ledgerPath:     s.ledgerPath,
    proposalsDir:   s.proposalsDir,
    contentDir:     s.contentDir,
    dryRunsDir:     s.dryRunsDir,
    submissionsDir: s.submissionsDir,
    clientFn:       () => makeNoopClient(),
    ...extraOpts,
  };
}

// ---- Tests ----

test('no argv → prints usage and exits 1', async () => {
  const s = setup();
  try {
    let exited = false;
    const origExit = process.exit;
    (process as any).exit = (code: number) => { exited = true; throw new Error(`exit:${code}`); };
    try {
      await submit(undefined, {}, makeOpts(s));
    } catch (e) {
      expect((e as Error).message).toBe('exit:1');
    }
    expect(exited).toBe(true);
    (process as any).exit = origExit;
  } finally {
    teardown(s.root);
  }
});

test('named transcript not found → exits 1', async () => {
  const s = setup();
  try {
    const origExit = process.exit;
    let exited = false;
    (process as any).exit = () => { exited = true; throw new Error('exit:1'); };
    try {
      await submit('nonexistent', {}, makeOpts(s));
    } catch {}
    expect(exited).toBe(true);
    (process as any).exit = origExit;
  } finally {
    teardown(s.root);
  }
});

test('named transcript not yet proposed → exits 1 with helpful message', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    const origExit = process.exit;
    let exited = false;
    const messages: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => messages.push(msg);
    (process as any).exit = () => { exited = true; throw new Error('exit:1'); };
    try {
      await submit('000', {}, makeOpts(s));
    } catch {}
    expect(exited).toBe(true);
    expect(messages.some((m) => m.includes('proposed') || m.includes('propose'))).toBe(true);
    (process as any).exit = origExit;
    console.error = origError;
  } finally {
    teardown(s.root);
  }
});

test('--all with nothing ready → logs nothing to submit', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    await submit(undefined, { all: true }, makeOpts(s));
    console.log = origLog;
    expect(logs.some((m) => m.includes('nothing to submit'))).toBe(true);
  } finally {
    teardown(s.root);
  }
});

test('--dry-run --all with one ready transcript → calls dry-run path, no real GitLab calls', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    const filename = '000.alpha.2025-8-28.txt';
    await populateProposals(s, filename);

    // Need to mark the transcript as proposed in the ledger.
    // Run submit with --all once to reconcile, then manually set stage.
    const contentHash = await hashFile(join(s.transcriptsDir, filename));
    let ledger = await readLedger(s.ledgerPath);
    if (ledger.entries.length === 0) {
      ledger = { entries: [{ filename, contentHash, stages: { segmented: null, extracted: null, resolved: null, matched: null, proposed: null, verified: null, prOpened: null }, errors: [] }] };
    }
    ledger = markStage(ledger, filename, 'proposed');
    await writeLedger(s.ledgerPath, ledger);

    const gitlabCalls: string[] = [];
    const mockClientFn = () => ({
      getProject:         async () => { gitlabCalls.push('getProject'); return { defaultBranch: 'main', webUrl: '' }; },
      branchExists:       async () => { gitlabCalls.push('branchExists'); return false; },
      createBranch:       async () => { gitlabCalls.push('createBranch'); },
      commitFiles:        async () => { gitlabCalls.push('commitFiles'); },
      createMergeRequest: async () => { gitlabCalls.push('createMergeRequest'); return { iid: 1, webUrl: '' }; },
      createDiscussion:   async () => { gitlabCalls.push('createDiscussion'); return { discussionId: 'disc-0' }; },
      listDiscussions:    async () => [],
      addDiscussionNote:  async () => { gitlabCalls.push('addDiscussionNote'); },
    });

    await submit(undefined, { all: true, dryRun: true }, {
      ...makeOpts(s),
      clientFn: mockClientFn,
    });

    expect(gitlabCalls).toHaveLength(0);

    const basename = '000.alpha.2025-8-28';
    const changesExists = await Bun.file(`${s.dryRunsDir}/${basename}/changes.json`).exists();
    expect(changesExists).toBe(true);
  } finally {
    teardown(s.root);
  }
});

test('ledger correctly written after mock success', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    const filename = '000.alpha.2025-8-28.txt';
    await populateProposals(s, filename);

    const contentHash = await hashFile(join(s.transcriptsDir, filename));
    let ledger = { entries: [{ filename, contentHash, stages: { segmented: null, extracted: null, resolved: null, matched: null, proposed: '2025-01-01T00:00:00Z', verified: null, prOpened: null }, errors: [] }] };
    await writeLedger(s.ledgerPath, ledger);

    await submit('000', {}, makeOpts(s));

    const updated = await readLedger(s.ledgerPath);
    const entry = updated.entries.find((e) => e.filename === filename)!;
    expect(entry.stages.verified).not.toBeNull();
    expect(entry.stages.prOpened).not.toBeNull();
    expect(entry.prUrl).toBe('https://gitlab.example.com/ns/proj/-/merge_requests/1');
  } finally {
    teardown(s.root);
  }
});
