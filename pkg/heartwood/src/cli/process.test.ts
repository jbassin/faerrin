import { test, expect, describe } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getTargets,
  processOneTranscript,
  process,
  buildCtx,
  LedgerMutex,
  type ProcessCliOptions,
} from './process';
import type { SegmentCtx } from './segment';
import type { ExtractCtx } from './extract';
import type { ResolveCtx } from './resolve';
import type { MatchCtx } from './match';
import type { ProposeCtx } from './propose';
import type { SubmitCtx } from '../github/submit';
import {
  readLedger, writeLedger, emptyLedger, markStage,
  type Ledger, type LedgerEntry, EMPTY_STAGES,
} from '../transcript/ledger';
import type { complete } from '../llm';

// ---- Mock process.exit ----

async function withMockedExit<T>(fn: () => Promise<T>): Promise<T> {
  const realExit = globalThis.process.exit;
  (globalThis.process as any).exit = (code: number) => {
    throw new Error(`process.exit(${code})`);
  };
  try {
    return await fn();
  } finally {
    (globalThis.process as any).exit = realExit;
  }
}

// ---- Fixtures ----

function makeEntry(
  filename: string,
  stageOverrides: Partial<LedgerEntry['stages']> = {},
  contentHash = 'abc123',
): LedgerEntry {
  return {
    filename,
    contentHash,
    stages: { ...EMPTY_STAGES, ...stageOverrides },
    errors: [],
  };
}

function makeTranscriptText(n: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(`${String(i).padStart(6, '0')}\tS: line ${i}`);
  return out.join('\n');
}

interface SetupResult {
  root:           string;
  transcriptsDir: string;
  segmentsDir:    string;
  claimsDir:      string;
  resolutionsDir: string;
  matchesDir:     string;
  proposalsDir:   string;
  contentDir:     string;
  dryRunsDir:     string;
  wikiIndexPath:  string;
  claudeMdPath:   string;
  ledgerPath:     string;
}

function setup(filenames: string[] = []): SetupResult {
  const root           = mkdtempSync(join(tmpdir(), 'process-test-'));
  const transcriptsDir = join(root, 'transcripts');
  const segmentsDir    = join(root, 'segments');
  const claimsDir      = join(root, 'claims');
  const resolutionsDir = join(root, 'resolutions');
  const matchesDir     = join(root, 'matches');
  const proposalsDir   = join(root, 'proposals');
  const contentDir     = join(root, 'content');
  const dryRunsDir     = join(root, 'dry-runs');

  mkdirSync(transcriptsDir);
  mkdirSync(contentDir,  { recursive: true });
  mkdirSync(dryRunsDir,  { recursive: true });

  for (const f of filenames) {
    writeFileSync(join(transcriptsDir, f), makeTranscriptText(60));
  }

  const wikiIndex = { pages: [], allEntities: [], wikilinks: [], generatedAt: '', totalPages: 0 };
  const wikiIndexPath = join(root, 'wiki-index.json');
  writeFileSync(wikiIndexPath, JSON.stringify(wikiIndex));

  const claudeMdPath = join(root, 'CLAUDE.md');
  writeFileSync(claudeMdPath, '# Conventions\n');

  return {
    root, transcriptsDir, segmentsDir, claimsDir, resolutionsDir,
    matchesDir, proposalsDir, contentDir, dryRunsDir, wikiIndexPath, claudeMdPath,
    ledgerPath: join(root, 'processed.json'),
  };
}

function teardown(root: string) {
  rmSync(root, { recursive: true, force: true });
}

function makeOpts(s: SetupResult, extras: Partial<ProcessCliOptions> = {}): ProcessCliOptions {
  return {
    transcriptsDir: s.transcriptsDir,
    ledgerPath:     s.ledgerPath,
    segmentsDir:    s.segmentsDir,
    claimsDir:      s.claimsDir,
    resolutionsDir: s.resolutionsDir,
    matchesDir:     s.matchesDir,
    proposalsDir:   s.proposalsDir,
    contentDir:     s.contentDir,
    dryRunsDir:     s.dryRunsDir,
    wikiIndexPath:  s.wikiIndexPath,
    claudeMdPath:   s.claudeMdPath,
    wikiIndex:      { pages: [], allEntities: [], wikilinks: [], generatedAt: '', totalPages: 0 } as never,
    models: { segment: 'test', extract: 'test', resolve: 'test', match: 'test', propose: 'test' },
    ...extras,
  };
}

// Fake completeFn for segment stage (matches the segmenter's window prompt)
const fakeSegmentComplete: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/Window covers lines (\d+)-(\d+)\./);
  const start = Number(m![1]);
  const end   = Number(m![2]);
  return {
    text: '',
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    value: {
      segments: [{ startLine: start, endLine: end, label: 'ic', confidence: 'high', oneLineSummary: 'play' }],
    },
  };
}) as never;

// Helper to build a ResolvedCtx-compatible object for processOneTranscript tests
interface TestCtx {
  ledgerPath:     string;
  transcriptsDir: string;
  segCtx:         Omit<SegmentCtx, 'writeLedgerFn'>;
  extCtx:         Omit<ExtractCtx, 'writeLedgerFn'>;
  resCtx:         Omit<ResolveCtx, 'writeLedgerFn'>;
  matchCtx:       Omit<MatchCtx, 'writeLedgerFn'>;
  propCtx:        Omit<ProposeCtx, 'writeLedgerFn'>;
  submitCtx:      Omit<SubmitCtx, 'dryRun' | 'writeLedgerFn'>;
}

function buildTestCtx(s: SetupResult, completeFn?: typeof complete): TestCtx {
  const emptyWiki = { pages: [], allEntities: [], wikilinks: [], generatedAt: '', totalPages: 0 } as never;
  return {
    ledgerPath:     s.ledgerPath,
    transcriptsDir: s.transcriptsDir,
    segCtx: {
      transcriptsDir: s.transcriptsDir,
      ledgerPath:     s.ledgerPath,
      segmentsDir:    s.segmentsDir,
      model:          'test-model',
      completeFn,
    },
    extCtx: {
      transcriptsDir:  s.transcriptsDir,
      ledgerPath:      s.ledgerPath,
      segmentsDir:     s.segmentsDir,
      claimsDir:       s.claimsDir,
      model:           'test-model',
      worthinessModel: 'test-model',
      completeFn,
    },
    resCtx: {
      transcriptsDir: s.transcriptsDir,
      ledgerPath:     s.ledgerPath,
      claimsDir:      s.claimsDir,
      resolutionsDir: s.resolutionsDir,
      model:          'test-model',
      completeFn,
      wikiIndex:      emptyWiki,
    },
    matchCtx: {
      transcriptsDir: s.transcriptsDir,
      ledgerPath:     s.ledgerPath,
      resolutionsDir: s.resolutionsDir,
      matchesDir:     s.matchesDir,
      contentDir:     s.contentDir,
      model:          'test-model',
      completeFn,
      wikiIndex:      emptyWiki,
    },
    propCtx: {
      transcriptsDir: s.transcriptsDir,
      ledgerPath:     s.ledgerPath,
      resolutionsDir: s.resolutionsDir,
      matchesDir:     s.matchesDir,
      segmentsDir:    s.segmentsDir,
      proposalsDir:   s.proposalsDir,
      contentDir:     s.contentDir,
      wikiIndexPath:  s.wikiIndexPath,
      claudeMdPath:   s.claudeMdPath,
      model:          'test-model',
      completeFn,
      wikiIndex:      emptyWiki,
    },
    submitCtx: {
      transcriptsDir: s.transcriptsDir,
      ledgerPath:     s.ledgerPath,
      proposalsDir:   s.proposalsDir,
      contentDir:     s.contentDir,
      dryRunsDir:     s.dryRunsDir,
      submissionsDir: join(s.root, 'submissions'),
      clientFn:       undefined,
    },
  };
}

// ---- getTargets tests ----

describe('getTargets', () => {
  const allFiles = new Set(['a.txt', 'b.txt', 'c.txt']);

  test('returns entries with any null stage', () => {
    const ts = new Date().toISOString();
    const allDone = { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts };
    const entries = [
      makeEntry('a.txt', {}),           // all null
      makeEntry('b.txt', { segmented: ts, extracted: ts }),  // partial
      makeEntry('c.txt', allDone),      // complete
    ];
    const targets = getTargets(entries, allFiles);
    expect(targets.map((e) => e.filename)).toEqual(['a.txt', 'b.txt']);
  });

  test('excludes entries not present on disk', () => {
    const entries = [makeEntry('a.txt'), makeEntry('missing.txt')];
    const targets = getTargets(entries, new Set(['a.txt']));
    expect(targets.map((e) => e.filename)).toEqual(['a.txt']);
  });

  test('stopBefore "segment" returns empty — no stages to run', () => {
    const entries = [makeEntry('a.txt')];
    expect(getTargets(entries, new Set(['a.txt']), 'segment')).toHaveLength(0);
  });

  test('stopBefore "extract" only checks segment completion', () => {
    const ts = new Date().toISOString();
    const entries = [
      makeEntry('a.txt', {}),              // segmented=null → still needs work
      makeEntry('b.txt', { segmented: ts }), // segmented done → no remaining stages before extract
    ];
    const targets = getTargets(entries, new Set(['a.txt', 'b.txt']), 'extract');
    expect(targets.map((e) => e.filename)).toEqual(['a.txt']);
  });

  test('stopBefore "submit" excludes entries that only have submit remaining', () => {
    const ts = new Date().toISOString();
    const doneUntilSubmit = { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts };
    const entries = [
      makeEntry('a.txt', doneUntilSubmit), // all through propose done, only submit left
      makeEntry('b.txt', {}),              // everything pending
    ];
    const targets = getTargets(entries, new Set(['a.txt', 'b.txt']), 'submit');
    // a.txt: segment..propose done → no remaining stages (submit not counted) → excluded
    // b.txt: segment=null → included
    expect(targets.map((e) => e.filename)).toEqual(['b.txt']);
  });

  test('empty entries returns empty', () => {
    expect(getTargets([], new Set())).toHaveLength(0);
  });
});

// ---- LedgerMutex tests ----

describe('LedgerMutex', () => {
  test('concurrent writes to different entries do not lose data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mutex-'));
    const ledgerPath = join(root, 'ledger.json');
    try {
      const initial: Ledger = { entries: [makeEntry('a.txt'), makeEntry('b.txt')] };
      await writeLedger(ledgerPath, initial);

      const mutex = new LedgerMutex();
      const writeA = mutex.makeWriter(ledgerPath, 'a.txt');
      const writeB = mutex.makeWriter(ledgerPath, 'b.txt');

      const ledgerA = markStage(initial, 'a.txt', 'segmented');
      const ledgerB = markStage(initial, 'b.txt', 'segmented');

      await Promise.all([writeA(ledgerPath, ledgerA), writeB(ledgerPath, ledgerB)]);

      const final = await readLedger(ledgerPath);
      expect(final.entries.find((e) => e.filename === 'a.txt')!.stages.segmented).not.toBeNull();
      expect(final.entries.find((e) => e.filename === 'b.txt')!.stages.segmented).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('second write sees first write changes (serialized)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mutex-'));
    const ledgerPath = join(root, 'ledger.json');
    try {
      const initial: Ledger = { entries: [makeEntry('a.txt'), makeEntry('b.txt')] };
      await writeLedger(ledgerPath, initial);

      const mutex = new LedgerMutex();
      const writeA = mutex.makeWriter(ledgerPath, 'a.txt');
      const writeB = mutex.makeWriter(ledgerPath, 'b.txt');

      // First write sets a.txt segmented
      const ledgerA = markStage(initial, 'a.txt', 'segmented');
      await writeA(ledgerPath, ledgerA);

      // Second write updates b.txt — should see a.txt's segmented state from disk
      const afterA = await readLedger(ledgerPath);
      const ledgerB = markStage(afterA, 'b.txt', 'segmented');
      await writeB(ledgerPath, ledgerB);

      const final = await readLedger(ledgerPath);
      expect(final.entries.find((e) => e.filename === 'a.txt')!.stages.segmented).not.toBeNull();
      expect(final.entries.find((e) => e.filename === 'b.txt')!.stages.segmented).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('merge preserves unrelated entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mutex-'));
    const ledgerPath = join(root, 'ledger.json');
    try {
      const initial: Ledger = {
        entries: [makeEntry('a.txt'), makeEntry('b.txt'), makeEntry('c.txt')],
      };
      await writeLedger(ledgerPath, initial);

      const mutex = new LedgerMutex();
      const writeA = mutex.makeWriter(ledgerPath, 'a.txt');
      const ledgerA = markStage(initial, 'a.txt', 'segmented');
      await writeA(ledgerPath, ledgerA);

      const final = await readLedger(ledgerPath);
      expect(final.entries.find((e) => e.filename === 'a.txt')!.stages.segmented).not.toBeNull();
      expect(final.entries.find((e) => e.filename === 'b.txt')!.stages.segmented).toBeNull();
      expect(final.entries.find((e) => e.filename === 'c.txt')!.stages.segmented).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejected write does not poison the queue — next write still executes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mutex-'));
    const ledgerPath = join(root, 'ledger.json');
    try {
      const initial: Ledger = { entries: [makeEntry('a.txt')] };
      await writeLedger(ledgerPath, initial);

      const mutex = new LedgerMutex();
      const badPath  = join(root, 'no-such-dir', 'ledger.json');
      const writeBad  = mutex.makeWriter(badPath, 'a.txt');
      const writeGood = mutex.makeWriter(ledgerPath, 'a.txt');

      const ledgerA = markStage(initial, 'a.txt', 'segmented');

      await writeBad(badPath, ledgerA).catch(() => {});
      await writeGood(ledgerPath, ledgerA);

      const final = await readLedger(ledgerPath);
      expect(final.entries[0]!.stages.segmented).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- processOneTranscript tests ----

describe('processOneTranscript', () => {
  test('skips all stages when all complete — no writeLedgerFn calls', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const ts = new Date().toISOString();
      const entry = makeEntry('000.alpha.2025-8-28.txt', {
        segmented: ts, extracted: ts, resolved: ts,
        matched: ts, proposed: ts, verified: ts, prOpened: ts,
      });
      await writeLedger(s.ledgerPath, { entries: [entry] });

      const writes: string[] = [];
      const ctx = buildTestCtx(s);
      await processOneTranscript('000.alpha.2025-8-28.txt', { dryRun: false }, ctx, async (p) => { writes.push(p); });

      expect(writes).toHaveLength(0);
    } finally {
      teardown(s.root);
    }
  });

  test('stopBefore "segment" — runs nothing', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const entry = makeEntry('000.alpha.2025-8-28.txt');
      await writeLedger(s.ledgerPath, { entries: [entry] });

      const writes: string[] = [];
      const ctx = buildTestCtx(s);
      await processOneTranscript('000.alpha.2025-8-28.txt', { dryRun: false, stopBefore: 'segment' }, ctx, async (p) => { writes.push(p); });

      expect(writes).toHaveLength(0);
    } finally {
      teardown(s.root);
    }
  });

  test('runs segment when segmented is null, stops before extract', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const entry = makeEntry('000.alpha.2025-8-28.txt');
      await writeLedger(s.ledgerPath, { entries: [entry] });

      const writes: number[] = [];
      const ctx = buildTestCtx(s, fakeSegmentComplete);
      await processOneTranscript(
        '000.alpha.2025-8-28.txt',
        { dryRun: false, stopBefore: 'extract' },
        ctx,
        async (path, ledger) => {
          writes.push(writes.length + 1);
          await writeLedger(path, ledger);
        },
      );

      expect(writes).toHaveLength(1);
      const ledger = await readLedger(s.ledgerPath);
      expect(ledger.entries[0]!.stages.segmented).not.toBeNull();
      expect(ledger.entries[0]!.stages.extracted).toBeNull();
    } finally {
      teardown(s.root);
    }
  });

  test('skips segment when already complete, runs nothing before extract', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const ts = new Date().toISOString();
      const entry = makeEntry('000.alpha.2025-8-28.txt', { segmented: ts });
      await writeLedger(s.ledgerPath, { entries: [entry] });

      const writes: string[] = [];
      const ctx = buildTestCtx(s);
      await processOneTranscript(
        '000.alpha.2025-8-28.txt',
        { dryRun: false, stopBefore: 'extract' },
        ctx,
        async (p) => { writes.push(p); },
      );

      expect(writes).toHaveLength(0);
    } finally {
      teardown(s.root);
    }
  });

  test('re-reads ledger before each stage — picks up external changes', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const entry = makeEntry('000.alpha.2025-8-28.txt');
      await writeLedger(s.ledgerPath, { entries: [entry] });

      let callCount = 0;
      const ctx = buildTestCtx(s, fakeSegmentComplete);

      await processOneTranscript(
        '000.alpha.2025-8-28.txt',
        { dryRun: false },
        ctx,
        async (path, ledger) => {
          callCount++;
          // After segment write, mark ALL remaining stages done so subsequent stages are skipped
          let next = ledger;
          const ts = new Date().toISOString();
          next = markStage(next, '000.alpha.2025-8-28.txt', 'segmented');
          next = markStage(next, '000.alpha.2025-8-28.txt', 'extracted');
          next = markStage(next, '000.alpha.2025-8-28.txt', 'resolved');
          next = markStage(next, '000.alpha.2025-8-28.txt', 'matched');
          next = markStage(next, '000.alpha.2025-8-28.txt', 'proposed');
          next = markStage(next, '000.alpha.2025-8-28.txt', 'verified');
          next = markStage(next, '000.alpha.2025-8-28.txt', 'prOpened');
          await writeLedger(path, next);
          void ts;
        },
      );

      // Only one write call: for segment. Subsequent stages see everything done on re-read.
      expect(callCount).toBe(1);
    } finally {
      teardown(s.root);
    }
  });

  test('throws when transcript not in ledger', async () => {
    const s = setup([]);
    try {
      await writeLedger(s.ledgerPath, emptyLedger());
      const ctx = buildTestCtx(s);
      await expect(
        processOneTranscript('nonexistent.txt', { dryRun: false }, ctx, async () => {}),
      ).rejects.toThrow('transcript not found in ledger');
    } finally {
      teardown(s.root);
    }
  });

  test('stage error propagates out of processOneTranscript', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const entry = makeEntry('000.alpha.2025-8-28.txt');
      await writeLedger(s.ledgerPath, { entries: [entry] });

      const ctx = buildTestCtx(s, (async () => { throw new Error('llm-failure'); }) as never);
      await expect(
        processOneTranscript(
          '000.alpha.2025-8-28.txt',
          { dryRun: false, stopBefore: 'extract' },
          ctx,
          async () => {},
        ),
      ).rejects.toThrow('llm-failure');
    } finally {
      teardown(s.root);
    }
  });

  test('writeLedgerFn is called by stage — injection verified', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const entry = makeEntry('000.alpha.2025-8-28.txt');
      await writeLedger(s.ledgerPath, { entries: [entry] });

      const received: Ledger[] = [];
      const ctx = buildTestCtx(s, fakeSegmentComplete);
      await processOneTranscript(
        '000.alpha.2025-8-28.txt',
        { dryRun: false, stopBefore: 'extract' },
        ctx,
        async (path, ledger) => {
          received.push(ledger);
          await writeLedger(path, ledger);
        },
      );

      expect(received).toHaveLength(1);
      expect(received[0]!.entries[0]!.stages.segmented).not.toBeNull();
    } finally {
      teardown(s.root);
    }
  });
});

// ---- process handler tests ----

describe('process', () => {
  test('exits 1 when no transcript name given', async () => {
    const s = setup();
    try {
      await expect(withMockedExit(() => process(undefined, {}, makeOpts(s)))).rejects.toThrow('process.exit(1)');
    } finally {
      teardown(s.root);
    }
  });

  test('exits 1 when --concurrency is passed without --all', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      await expect(withMockedExit(() => process('000', { concurrency: 2 }, makeOpts(s)))).rejects.toThrow('process.exit(1)');
    } finally {
      teardown(s.root);
    }
  });

  test('exits 1 when transcript not found', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      await expect(withMockedExit(() => process('nonexistent', {}, makeOpts(s)))).rejects.toThrow('process.exit(1)');
    } finally {
      teardown(s.root);
    }
  });

  test('reconciles ledger and resolves transcript by partial name', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const bytes = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const ts = new Date().toISOString();
      const doneEntry: LedgerEntry = {
        filename: '000.alpha.2025-8-28.txt',
        contentHash: hash,
        stages: { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts },
        errors: [],
      };
      await writeLedger(s.ledgerPath, { entries: [doneEntry] });

      await process('000', {}, makeOpts(s));
      const ledger = await readLedger(s.ledgerPath);
      expect(ledger.entries[0]!.filename).toBe('000.alpha.2025-8-28.txt');
    } finally {
      teardown(s.root);
    }
  });

  test('--force resets stages from given stage onward', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const bytes = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const ts = new Date().toISOString();
      const doneEntry: LedgerEntry = {
        filename: '000.alpha.2025-8-28.txt',
        contentHash: hash,
        stages: { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts },
        errors: [],
        prUrl: 'https://example.com/mr/1',
      };
      await writeLedger(s.ledgerPath, { entries: [doneEntry] });

      // --force propose --stop-before propose → reset from propose, then stop before running it
      await process('000', { force: 'propose', stopBefore: 'propose' }, makeOpts(s));

      const ledger = await readLedger(s.ledgerPath);
      const entry = ledger.entries[0]!;
      expect(entry.stages.proposed).toBeNull();
      expect(entry.stages.verified).toBeNull();
      expect(entry.stages.prOpened).toBeNull();
      expect(entry.prUrl).toBeUndefined();
      // segment..match preserved
      expect(entry.stages.segmented).not.toBeNull();
      expect(entry.stages.matched).not.toBeNull();
    } finally {
      teardown(s.root);
    }
  });

  test('--force segment resets all stages', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const bytes = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const ts = new Date().toISOString();
      const doneEntry: LedgerEntry = {
        filename: '000.alpha.2025-8-28.txt',
        contentHash: hash,
        stages: { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts },
        errors: [],
      };
      await writeLedger(s.ledgerPath, { entries: [doneEntry] });

      // Force from segment, stop before segment → resets all, then stops before running
      await process('000', { force: 'segment', stopBefore: 'segment' }, makeOpts(s));

      const ledger = await readLedger(s.ledgerPath);
      const entry = ledger.entries[0]!;
      expect(entry.stages.segmented).toBeNull();
      expect(entry.stages.extracted).toBeNull();
    } finally {
      teardown(s.root);
    }
  });

  test('exits 1 when --force is passed with --all', async () => {
    const s = setup();
    try {
      await expect(withMockedExit(() => process(undefined, { all: true, force: 'propose' }, makeOpts(s)))).rejects.toThrow('process.exit(1)');
    } finally {
      teardown(s.root);
    }
  });

  test('exits 1 when name and --all are combined', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      await expect(withMockedExit(() => process('000', { all: true }, makeOpts(s)))).rejects.toThrow('process.exit(1)');
    } finally {
      teardown(s.root);
    }
  });

  test('logs "nothing to process" when all transcripts complete', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const bytes = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const ts = new Date().toISOString();
      const done: LedgerEntry = {
        filename: '000.alpha.2025-8-28.txt', contentHash: hash,
        stages: { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts },
        errors: [],
      };
      await writeLedger(s.ledgerPath, { entries: [done] });
      await process(undefined, { all: true }, makeOpts(s));
      // No throw — "nothing to process" logged
    } finally {
      teardown(s.root);
    }
  });

  test('--stop-before segment: no targets → "nothing to process"', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      await process(undefined, { all: true, stopBefore: 'segment' }, makeOpts(s));
    } finally {
      teardown(s.root);
    }
  });

  test('collects failures without aborting, throws at end with count', async () => {
    const s = setup(['000.alpha.2025-8-28.txt', '001.beta.2025-9-1.txt']);
    try {
      const brokenFn = (async () => { throw new Error('intentional-fail'); }) as never;
      await expect(process(undefined, { all: true }, makeOpts(s, { completeFn: brokenFn }))).rejects.toThrow('transcript(s) failed');
    } finally {
      teardown(s.root);
    }
  });

  test('--concurrency 2 with all complete: no targets processed', async () => {
    const s = setup(['000.alpha.2025-8-28.txt', '001.beta.2025-9-1.txt']);
    try {
      const ts = new Date().toISOString();
      const allDone = (f: string, h: string): LedgerEntry => ({
        filename: f, contentHash: h,
        stages: { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts },
        errors: [],
      });
      const bytes0 = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      const hash0 = new Bun.CryptoHasher('sha256').update(bytes0).digest('hex');
      const bytes1 = await Bun.file(join(s.transcriptsDir, '001.beta.2025-9-1.txt')).bytes();
      const hash1 = new Bun.CryptoHasher('sha256').update(bytes1).digest('hex');
      await writeLedger(s.ledgerPath, { entries: [allDone('000.alpha.2025-8-28.txt', hash0), allDone('001.beta.2025-9-1.txt', hash1)] });
      await process(undefined, { all: true, concurrency: 2 }, makeOpts(s));
      // No throw
    } finally {
      teardown(s.root);
    }
  });

  test('writes summary markdown after run (with failure)', async () => {
    const s = setup(['000.alpha.2025-8-28.txt']);
    try {
      const brokenFn = (async () => { throw new Error('fail'); }) as never;
      await expect(process(undefined, { all: true }, makeOpts(s, { completeFn: brokenFn }))).rejects.toThrow();
      // After the run, a summary file should exist in state/runs/
      const { readdir } = await import('node:fs/promises');
      const summaryFiles = (await readdir('state/runs').catch(() => [] as string[])).filter((f: string) => f.endsWith('-summary.md'));
      expect(summaryFiles.length).toBeGreaterThan(0);
    } finally {
      teardown(s.root);
    }
  });

  test('includes correct result and failure info in summary', async () => {
    const s = setup(['000.alpha.2025-8-28.txt', '001.beta.2025-9-1.txt']);
    try {
      const bytes0 = await Bun.file(join(s.transcriptsDir, '000.alpha.2025-8-28.txt')).bytes();
      const hash0 = new Bun.CryptoHasher('sha256').update(bytes0).digest('hex');
      const ts = new Date().toISOString();
      // Pre-mark 000 as all done, 001 will fail
      const done: LedgerEntry = {
        filename: '000.alpha.2025-8-28.txt', contentHash: hash0,
        stages: { segmented: ts, extracted: ts, resolved: ts, matched: ts, proposed: ts, verified: ts, prOpened: ts },
        errors: [],
      };
      await writeLedger(s.ledgerPath, { entries: [done] });

      // 001.beta needs processing but completeFn throws → failure
      const brokenFn = (async () => { throw new Error('deliberate'); }) as never;
      await expect(process(undefined, { all: true }, makeOpts(s, { completeFn: brokenFn }))).rejects.toThrow();

      const { readdir, readFile } = await import('node:fs/promises');
      const runs = await readdir('state/runs').catch(() => [] as string[]);
      const summaries = runs.filter((f: string) => f.endsWith('-summary.md')).sort();
      const latest = summaries[summaries.length - 1];
      if (latest) {
        const content = await readFile(`state/runs/${latest}`, 'utf8');
        expect(content).toContain('## Transcripts');
        expect(content).toContain('✗ failed');
      }
    } finally {
      teardown(s.root);
    }
  });
});

describe('buildCtx defaults', () => {
  // Regression: process used to default contentDir to 'content' while every other
  // CLI (match/propose/submit/index-wiki) uses '../content/wiki'. That made match
  // open 'content/Org/.../Page.md' (ENOENT) the first time a session resolved a
  // claim to an existing wiki page. Guard the wiki root the orchestrator feeds the
  // page-reading stages.
  const emptyIndex = { pages: [], allEntities: [], wikilinks: [], generatedAt: '', totalPages: 0 } as never;

  test('contentDir falls back to the monorepo wiki root for match/propose/submit', async () => {
    const ctx = await buildCtx({ wikiIndex: emptyIndex });
    expect(ctx.matchCtx.contentDir).toBe('../content/wiki');
    expect(ctx.propCtx.contentDir).toBe('../content/wiki');
    expect(ctx.submitCtx.contentDir).toBe('../content/wiki');
  });

  test('an explicit contentDir override is still honored', async () => {
    const ctx = await buildCtx({ wikiIndex: emptyIndex, contentDir: '/tmp/wiki' });
    expect(ctx.matchCtx.contentDir).toBe('/tmp/wiki');
    expect(ctx.submitCtx.contentDir).toBe('/tmp/wiki');
  });
});
