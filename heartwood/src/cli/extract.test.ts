import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract } from './extract';
import { segment } from './segment';
import { readLedger, markStage, writeLedger } from '../transcript/ledger';
import type { complete } from '../llm';

// ---- Helpers ----

function makeTranscriptText(n: number, speaker = 'Gamemaster'): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(`${String(i).padStart(6, '0')}\t${speaker}: line ${i}`);
  }
  return out.join('\n');
}

// Fake segment completeFn: returns a single ic window covering the range.
const segmentFake: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/Window covers lines (\d+)-(\d+)\./);
  const start = Number(m![1]); const end = Number(m![2]);
  return {
    text: '',
    usage: {} as never,
    value: { segments: [{ startLine: start, endLine: end, label: 'ic', confidence: 'high', oneLineSummary: 'play' }] },
  };
}) as never;

// Fake extract completeFn: returns a single claim per unit.
const extractFake: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/lines (\d+)/);
  const startLine = Number(m?.[1] ?? 1);
  return {
    text: '',
    usage: {} as never,
    value: {
      claims: [{
        claim: `Fact from line ${startLine}`,
        lineStart: startLine,
        lineEnd: startLine + 1,
        speaker: 'Gamemaster',
        role: 'gm',
        confidence: 'stated',
        entities: [],
      }],
    },
  };
}) as never;

interface Setup {
  root:           string;
  transcriptsDir: string;
  ledgerPath:     string;
  segmentsDir:    string;
  claimsDir:      string;
}

function setup(transcripts: Record<string, string> = {}): Setup {
  const root           = mkdtempSync(join(tmpdir(), 'extract-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const segmentsDir    = join(root, 'segments');
  const claimsDir      = join(root, 'claims');
  const ledgerPath     = join(root, 'processed.json');
  mkdirSync(transcriptsDir);
  mkdirSync(segmentsDir);
  mkdirSync(claimsDir);

  // Default transcripts if none provided.
  if (Object.keys(transcripts).length === 0) {
    writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), makeTranscriptText(60));
    writeFileSync(join(transcriptsDir, '101.beta.2026-1-1.txt'),   makeTranscriptText(50));
  } else {
    for (const [name, text] of Object.entries(transcripts)) {
      writeFileSync(join(transcriptsDir, name), text);
    }
  }
  return { root, transcriptsDir, ledgerPath, segmentsDir, claimsDir };
}

function teardown(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

async function segmentAll(s: Setup): Promise<void> {
  await segment(undefined, { all: true }, {
    transcriptsDir: s.transcriptsDir,
    ledgerPath:     s.ledgerPath,
    segmentsDir:    s.segmentsDir,
    model:          'fake-model',
    completeFn:     segmentFake,
  });
}

// ---- Tests ----

test('single-transcript run writes claims JSON and sets stages.extracted', async () => {
  const s = setup();
  try {
    await segmentAll(s);
    await extract('alpha', {}, {
      transcriptsDir: s.transcriptsDir,
      ledgerPath:     s.ledgerPath,
      segmentsDir:    s.segmentsDir,
      claimsDir:      s.claimsDir,
      model:          'fake-model',
      completeFn:     extractFake,
    });

    const outPath = join(s.claimsDir, '000.alpha.2025-8-28.txt.json');
    expect(existsSync(outPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(payload.filename).toBe('000.alpha.2025-8-28.txt');
    expect(payload.totalLines).toBe(60);
    expect(Array.isArray(payload.claims)).toBe(true);
    expect(payload.claims.length).toBeGreaterThan(0);
    expect(typeof payload.coverage.percentOfTranscript).toBe('number');

    const l = await readLedger(s.ledgerPath);
    const e = l.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.extracted).not.toBeNull();
  } finally { teardown(s.root); }
});

test('claims JSON is valid and has expected top-level keys', async () => {
  const s = setup();
  try {
    await segmentAll(s);
    await extract('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: extractFake,
    });
    const payload = JSON.parse(readFileSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    expect(payload).toHaveProperty('contentHash');
    expect(payload).toHaveProperty('segmentsContentHash');
    expect(payload).toHaveProperty('unitCount');
    expect(payload).toHaveProperty('droppedCount');
    expect(payload).toHaveProperty('repairedCount');
    expect(payload).toHaveProperty('coverage');
    expect(payload.coverage).toHaveProperty('lines');
    expect(payload.coverage).toHaveProperty('percentOfTranscript');
  } finally { teardown(s.root); }
});

test('claims are sorted by lines[0] ascending', async () => {
  const s = setup();
  try {
    await segmentAll(s);
    await extract('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: extractFake,
    });
    const payload = JSON.parse(readFileSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    const starts = (payload.claims as any[]).map((c: any) => c.lines[0]);
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  } finally { teardown(s.root); }
});

test('output is byte-identical on a second run with the same fake', async () => {
  const s = setup();
  try {
    await segmentAll(s);
    const extractOpts = {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: extractFake,
    };

    await extract('alpha', {}, extractOpts);
    const outPath = join(s.claimsDir, '000.alpha.2025-8-28.txt.json');
    const first = readFileSync(outPath, 'utf8');

    // Reset stages.extracted so a re-run is allowed.
    let l = await readLedger(s.ledgerPath);
    l = { entries: l.entries.map((e) => ({ ...e, stages: { ...e.stages, extracted: null } })) };
    await writeLedger(s.ledgerPath, l);

    await extract('alpha', {}, extractOpts);
    const second = readFileSync(outPath, 'utf8');
    expect(second).toBe(first);
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.extracted is already set', async () => {
  const s = setup();
  try {
    await segmentAll(s);

    // Pre-mark alpha as extracted.
    let l = await readLedger(s.ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'extracted', '2026-01-01T00:00:00Z');
    await writeLedger(s.ledgerPath, l);

    let callCount = 0;
    const countingFake: typeof complete = (async (args: any) => {
      callCount++;
      return extractFake(args as any);
    }) as never;

    await extract(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: countingFake,
    });

    // Only beta should have been extracted (1 extract unit + 1 worthiness filter call).
    expect(callCount).toBe(2);
    expect(existsSync(join(s.claimsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all skips transcripts whose stages.segmented is null', async () => {
  const s = setup();
  try {
    // Only segment alpha, not beta.
    await segment('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, model: 'fake-model', completeFn: segmentFake,
    });

    let callCount = 0;
    const countingFake: typeof complete = (async (args: any) => {
      callCount++;
      return extractFake(args as any);
    }) as never;

    await extract(undefined, { all: true }, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: countingFake,
    });

    // Only alpha was segmented, so only alpha should be extracted (1 extract unit + 1 worthiness filter call).
    expect(callCount).toBe(2);
    expect(existsSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'))).toBe(true);
    expect(existsSync(join(s.claimsDir, '101.beta.2026-1-1.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('--all continues past a per-transcript failure and exits with error', async () => {
  const s = setup();
  try {
    await segmentAll(s);

    let n = 0;
    const failFirstFake: typeof complete = (async (args: any) => {
      n++;
      if (n === 1) throw new Error('synthetic LLM failure');
      return extractFake(args as any);
    }) as never;

    let threw = false;
    try {
      await extract(undefined, { all: true }, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
        model: 'fake-model', completeFn: failFirstFake,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const l = await readLedger(s.ledgerPath);
    const alpha = l.entries.find((e) => e.filename === '000.alpha.2025-8-28.txt')!;
    const beta  = l.entries.find((e) => e.filename === '101.beta.2026-1-1.txt')!;
    // One succeeded, one failed (whichever came first in discovery order).
    const oneExtracted = (alpha.stages.extracted !== null) !== (beta.stages.extracted !== null);
    expect(oneExtracted).toBe(true);
    const oneErrored =
      alpha.errors.some((e) => e.stage === 'extracted') ||
      beta.errors.some((e) => e.stage === 'extracted');
    expect(oneErrored).toBe(true);
  } finally { teardown(s.root); }
});

test('errors when segments file is missing', async () => {
  const s = setup();
  try {
    // Reconcile ledger but do NOT run segment (no segments file).
    const prior = await readLedger(s.ledgerPath);
    const { discoverTranscripts } = await import('../transcript/discover');
    const { files } = await discoverTranscripts(s.transcriptsDir);
    const { reconcile, writeLedger } = await import('../transcript/ledger');
    const { ledger } = reconcile(prior, files);
    // Mark segmented without actually creating a file.
    const { markStage } = await import('../transcript/ledger');
    const faked = markStage(ledger, '000.alpha.2025-8-28.txt', 'segmented');
    await writeLedger(s.ledgerPath, faked);

    let threw = false;
    try {
      await extract('alpha', {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
        model: 'fake-model', completeFn: extractFake,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('segments file missing');
    }
    expect(threw).toBe(true);
  } finally { teardown(s.root); }
});

test('errors when contentHash mismatches (transcript changed since segmentation)', async () => {
  const s = setup();
  try {
    await segmentAll(s);

    // Overwrite the transcript with different content.
    writeFileSync(
      join(s.transcriptsDir, '000.alpha.2025-8-28.txt'),
      makeTranscriptText(61), // different from the 60-line version that was segmented
    );
    // Re-reconcile so ledger has new contentHash, but segments file still has old one.
    const { discoverTranscripts } = await import('../transcript/discover');
    const { files } = await discoverTranscripts(s.transcriptsDir);
    const l = await readLedger(s.ledgerPath);
    const { reconcile } = await import('../transcript/ledger');
    const { ledger: newLedger } = reconcile(l, files);
    // Preserve the segmented timestamp so extract is attempted.
    const patchedLedger = {
      entries: newLedger.entries.map((e) =>
        e.filename === '000.alpha.2025-8-28.txt'
          ? { ...e, stages: { ...e.stages, segmented: '2026-01-01T00:00:00Z' } }
          : e,
      ),
    };
    await writeLedger(s.ledgerPath, patchedLedger);

    let threw = false;
    try {
      await extract('alpha', {}, {
        transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
        segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
        model: 'fake-model', completeFn: extractFake,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('transcript changed since segmentation');
    }
    expect(threw).toBe(true);
  } finally { teardown(s.root); }
});

test('debug files are written per unit', async () => {
  const s = setup();
  try {
    await segmentAll(s);
    await extract('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: extractFake,
    });

    const debugDir = join(s.claimsDir, '_debug', '000.alpha.2025-8-28.txt');
    expect(existsSync(debugDir)).toBe(true);
    const { readdirSync } = await import('node:fs');
    const debugFiles = readdirSync(debugDir);
    expect(debugFiles.length).toBeGreaterThan(0);
    // Each debug file should be valid JSON with rawClaims and keptClaims.
    for (const f of debugFiles) {
      const d = JSON.parse(readFileSync(join(debugDir, f), 'utf8'));
      expect(Array.isArray(d.rawClaims)).toBe(true);
      expect(Array.isArray(d.keptClaims)).toBe(true);
    }
  } finally { teardown(s.root); }
});

test('substring lookup resolves to the correct transcript', async () => {
  const s = setup();
  try {
    await segmentAll(s);
    await extract('beta', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: extractFake,
    });
    expect(existsSync(join(s.claimsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(s.root); }
});

test('coverage percentOfTranscript is correct for a known setup', async () => {
  // 60-line transcript entirely IC → 100% coverage.
  const s = setup();
  try {
    await segmentAll(s);
    await extract('alpha', {}, {
      transcriptsDir: s.transcriptsDir, ledgerPath: s.ledgerPath,
      segmentsDir: s.segmentsDir, claimsDir: s.claimsDir,
      model: 'fake-model', completeFn: extractFake,
    });
    const payload = JSON.parse(readFileSync(join(s.claimsDir, '000.alpha.2025-8-28.txt.json'), 'utf8'));
    // The fake segment completeFn produces a single ic segment covering all 60 lines.
    expect(payload.coverage.lines).toBe(60);
    expect(payload.coverage.percentOfTranscript).toBe(100);
  } finally { teardown(s.root); }
});
