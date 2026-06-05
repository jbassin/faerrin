import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { respond } from './respond';
import { writeLedger, markStage, setPrUrl, emptyLedger } from '../transcript/ledger';
import { writeSubmissions } from '../github/submissions';
import type { GitHubClient } from '../github/client';

// ---- Helpers ----

interface Setup {
  root:           string;
  transcriptsDir: string;
  ledgerPath:     string;
  submissionsDir: string;
  proposalsDir:   string;
  contentDir:     string;
}

function setup(transcriptNames: string[] = ['000.alpha.2025-8-28.txt']): Setup {
  const root           = mkdtempSync(join(tmpdir(), 'respond-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const submissionsDir = join(root, 'submissions');
  const proposalsDir   = join(root, 'proposals');
  const contentDir     = join(root, 'content');

  mkdirSync(transcriptsDir);
  mkdirSync(submissionsDir, { recursive: true });
  mkdirSync(proposalsDir,   { recursive: true });
  mkdirSync(contentDir,     { recursive: true });

  for (const name of transcriptNames) {
    writeFileSync(join(transcriptsDir, name), 'session transcript line\n');
  }

  // Minimal stub CLAUDE.md
  writeFileSync(join(root, 'CLAUDE.md'), '## Content Files\nStub.\n\n---\n\nDefault to using Bun\n');

  return {
    root,
    transcriptsDir,
    ledgerPath:    join(root, 'processed.json'),
    submissionsDir,
    proposalsDir,
    contentDir,
  };
}

function teardown(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

function makeNoopClient(): GitHubClient {
  return {
    getProject:          async () => ({ defaultBranch: 'main', webUrl: 'https://github.com/ns/proj' }),
    branchExists:        async () => false,
    createBranch:        async () => {},
    commitFiles:         async () => 'deadbeef',
    createPullRequest:   async () => ({ number: 1, webUrl: 'https://github.com/ns/proj/pull/1' }),
    createReviewComment: async () => ({ discussionId: 'disc-0' }),
    listDiscussions:     async () => [],
    addDiscussionNote:   async () => {},
    addIssueComment:     async () => {},
  };
}

function makeOpts(s: Setup, extraOpts: object = {}) {
  return {
    transcriptsDir:  s.transcriptsDir,
    ledgerPath:      s.ledgerPath,
    submissionsDir:  s.submissionsDir,
    proposalsDir:    s.proposalsDir,
    contentDir:      s.contentDir,
    conventionsPath: join(s.root, 'CLAUDE.md'),
    clientFn:        () => makeNoopClient(),
    ...extraOpts,
  };
}

async function seedLedgerWithPrOpened(s: Setup, filename: string): Promise<void> {
  const contentHash = await (async () => {
    const bytes = await Bun.file(join(s.transcriptsDir, filename)).bytes();
    return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  })();
  let ledger = emptyLedger();
  ledger = { entries: [{ filename, contentHash, stages: { segmented: null, extracted: null, resolved: null, matched: null, proposed: '2025-01-01T00:00:00Z', verified: '2025-01-02T00:00:00Z', prOpened: '2025-01-03T00:00:00Z' }, errors: [], prNumber: 1 }] };
  await writeLedger(s.ledgerPath, ledger);

  const basename = filename.endsWith('.txt') ? filename.slice(0, -4) : filename;
  await writeSubmissions(join(s.submissionsDir, `${basename}.json`), {
    filename, prNumber: 1, branch: `wiki/${basename}`, discussions: [],
  });

  writeFileSync(join(s.proposalsDir, `${filename}.json`), JSON.stringify({
    filename, contentHash, proposals: [],
  }));
}

// ---- Tests ----

test('no argv → prints usage and exits 1', async () => {
  const s = setup();
  try {
    const origExit = process.exit;
    let exited = false;
    (process as any).exit = (code: number) => { exited = true; throw new Error(`exit:${code}`); };
    try {
      await respond(undefined, {}, makeOpts(s));
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
      await respond('nonexistent', {}, makeOpts(s));
    } catch {}
    expect(exited).toBe(true);
    (process as any).exit = origExit;
  } finally {
    teardown(s.root);
  }
});

test('named transcript with ambiguous match → exits 1', async () => {
  const s = setup(['000.alpha.2025-8-28.txt', '000.alpha.2025-9-1.txt']);
  try {
    // Seed both as prOpened
    for (const name of ['000.alpha.2025-8-28.txt', '000.alpha.2025-9-1.txt']) {
      await seedLedgerWithPrOpened(s, name);
    }
    const origExit = process.exit;
    let exited = false;
    (process as any).exit = () => { exited = true; throw new Error('exit:1'); };
    try {
      await respond('alpha', {}, makeOpts(s));
    } catch {}
    expect(exited).toBe(true);
    (process as any).exit = origExit;
  } finally {
    teardown(s.root);
  }
});

test('named transcript not yet submitted → exits 1', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    // No prOpened stage
    const contentHash = await (async () => {
      const bytes = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    })();
    const ledger = { entries: [{ filename: '000.alpha.2025-8-28.txt', contentHash, stages: { segmented: null, extracted: null, resolved: null, matched: null, proposed: '2025-01-01T00:00:00Z', verified: null, prOpened: null }, errors: [] }] };
    await writeLedger(s.ledgerPath, ledger);

    const origExit = process.exit;
    let exited = false;
    (process as any).exit = () => { exited = true; throw new Error('exit:1'); };
    try {
      await respond('alpha', {}, makeOpts(s));
    } catch {}
    expect(exited).toBe(true);
    (process as any).exit = origExit;
  } finally {
    teardown(s.root);
  }
});

test('--all with no open PRs → logs nothing to respond', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    await respond(undefined, { all: true }, makeOpts(s));
    console.log = origLog;
    expect(logs.some((m) => m.includes('nothing to respond'))).toBe(true);
  } finally {
    teardown(s.root);
  }
});

test('named transcript with open PR → calls respondOne (no discussions = no-op)', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    await seedLedgerWithPrOpened(s, '000.alpha.2025-8-28.txt');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    await respond('alpha', {}, makeOpts(s));
    console.log = origLog;

    expect(logs.some((m) => m.includes('nothing to do'))).toBe(true);
  } finally {
    teardown(s.root);
  }
});

test('--all with one open PR → processes it', async () => {
  const s = setup(['000.alpha.2025-8-28.txt']);
  try {
    await seedLedgerWithPrOpened(s, '000.alpha.2025-8-28.txt');

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    await respond(undefined, { all: true }, makeOpts(s));
    console.log = origLog;

    expect(logs.some((m) => m.includes('done: 1/1'))).toBe(true);
  } finally {
    teardown(s.root);
  }
});
