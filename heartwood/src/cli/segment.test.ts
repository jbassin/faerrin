import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { segment } from './segment';
import { readLedger, markStage, writeLedger } from '../transcript/ledger';
import type { complete } from '../llm';

function makeTranscriptText(n: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(`${String(i).padStart(6, '0')}\tS: line ${i}`);
  return out.join('\n');
}

function setup() {
  const root           = mkdtempSync(join(tmpdir(), 'segment-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const ledgerPath     = join(root, 'processed.json');
  const segmentsDir    = join(root, 'segments');
  mkdirSync(transcriptsDir);
  writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), makeTranscriptText(60));
  writeFileSync(join(transcriptsDir, '101.beta.2026-1-1.txt'),   makeTranscriptText(50));
  return { root, transcriptsDir, ledgerPath, segmentsDir };
}

function teardown(root: string) {
  rmSync(root, { recursive: true, force: true });
}

// Fake completeFn: identifies window via the user prompt's header and returns one ic-segment per window.
const goodFake: typeof complete = (async (args: any) => {
  const m = (args.user as string).match(/Window covers lines (\d+)-(\d+)\./);
  const start = Number(m![1]); const end = Number(m![2]);
  return {
    text: '',
    usage: {} as never,
    value: {
      segments: [{
        startLine: start, endLine: end,
        label: 'ic', confidence: 'high',
        oneLineSummary: 'play',
      }],
    },
  };
}) as never;

test('single-transcript run writes JSON and sets stages.segmented', async () => {
  const { root, transcriptsDir, ledgerPath, segmentsDir } = setup();
  try {
    await segment('2025-8-28', {}, {
      transcriptsDir, ledgerPath, segmentsDir,
      model: 'fake-model', completeFn: goodFake,
    });
    const outPath = join(segmentsDir, '000.alpha.2025-8-28.txt.json');
    expect(existsSync(outPath)).toBe(true);
    const payload = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(payload.filename).toBe('000.alpha.2025-8-28.txt');
    expect(payload.totalLines).toBe(60);
    expect(payload.segments.length).toBeGreaterThan(0);
    // Coverage: first starts at 1, last ends at totalLines, no gaps.
    expect(payload.segments[0].startLine).toBe(1);
    expect(payload.segments[payload.segments.length - 1].endLine).toBe(60);
    for (let i = 1; i < payload.segments.length; i++) {
      expect(payload.segments[i].startLine).toBe(payload.segments[i - 1].endLine + 1);
    }
    const l = await readLedger(ledgerPath);
    const e = l.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.segmented).not.toBeNull();
  } finally { teardown(root); }
});

test('output JSON is byte-identical on a second run with the same fake', async () => {
  const { root, transcriptsDir, ledgerPath, segmentsDir } = setup();
  try {
    await segment('2025-8-28', {}, {
      transcriptsDir, ledgerPath, segmentsDir,
      model: 'fake-model', completeFn: goodFake,
    });
    const outPath = join(segmentsDir, '000.alpha.2025-8-28.txt.json');
    const first = readFileSync(outPath, 'utf8');

    // Clear stages.segmented so a second run re-segments.
    let l = await readLedger(ledgerPath);
    l = { entries: l.entries.map((e) => ({ ...e, stages: { ...e.stages, segmented: null } })) };
    await writeLedger(ledgerPath, l);

    await segment('2025-8-28', {}, {
      transcriptsDir, ledgerPath, segmentsDir,
      model: 'fake-model', completeFn: goodFake,
    });
    const second = readFileSync(outPath, 'utf8');
    expect(second).toBe(first);
  } finally { teardown(root); }
});

test('--all skips transcripts whose stages.segmented is already set', async () => {
  const { root, transcriptsDir, ledgerPath, segmentsDir } = setup();
  try {
    // Seed ledger: pre-mark alpha as segmented so only beta should be processed.
    await segment(undefined, { all: true }, {
      transcriptsDir, ledgerPath, segmentsDir,
      model: 'fake-model',
      completeFn: (async () => { throw new Error('should not be called for already-segmented'); }) as never,
    }).catch(() => {/* drain initial reconcile-only run */});

    // Reset ledger after the (failed) run so we can stage cleanly.
    let l = await readLedger(ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'segmented', '2026-01-01T00:00:00Z');
    await writeLedger(ledgerPath, l);

    let callCount = 0;
    const fake: typeof complete = (async (args: any) => {
      callCount++;
      const m = (args.user as string).match(/Window covers lines (\d+)-(\d+)\./);
      const start = Number(m![1]); const end = Number(m![2]);
      return {
        text: '',
        usage: {} as never,
        value: {
          segments: [{
            startLine: start, endLine: end,
            label: 'ic', confidence: 'high', oneLineSummary: 'play',
          }],
        },
      };
    }) as never;

    await segment(undefined, { all: true }, {
      transcriptsDir, ledgerPath, segmentsDir,
      model: 'fake-model', completeFn: fake,
    });

    // Only beta (50 lines, single window) should have been processed.
    expect(callCount).toBe(1);
    expect(existsSync(join(segmentsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    // Alpha was already segmented; its segments file should not exist.
    expect(existsSync(join(segmentsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(root); }
});

test('--all continues past a per-transcript failure, records the error, and throws at the end', async () => {
  const { root, transcriptsDir, ledgerPath, segmentsDir } = setup();
  try {
    let n = 0;
    const fake: typeof complete = (async (args: any) => {
      n++;
      // First transcript: throw on its (only) window.
      // Second transcript: succeed.
      const m = (args.user as string).match(/Window covers lines (\d+)-(\d+)\./);
      const start = Number(m![1]); const end = Number(m![2]);
      if (n === 1) throw new Error('synthetic LLM failure');
      return {
        text: '',
        usage: {} as never,
        value: {
          segments: [{
            startLine: start, endLine: end,
            label: 'ic', confidence: 'high', oneLineSummary: 'play',
          }],
        },
      };
    }) as never;

    let threw = false;
    try {
      await segment(undefined, { all: true }, {
        transcriptsDir, ledgerPath, segmentsDir,
        model: 'fake-model', completeFn: fake,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const l = await readLedger(ledgerPath);
    // Sort entries by filename so the order is deterministic regardless of discovery order.
    const alpha = l.entries.find((e) => e.filename === '000.alpha.2025-8-28.txt')!;
    const beta  = l.entries.find((e) => e.filename === '101.beta.2026-1-1.txt')!;
    expect(alpha.stages.segmented).toBeNull();
    expect(alpha.errors.some((er) => er.stage === 'segmented')).toBe(true);
    expect(beta.stages.segmented).not.toBeNull();
    expect(existsSync(join(segmentsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
  } finally { teardown(root); }
});

test('substring lookup resolves to the right file', async () => {
  const { root, transcriptsDir, ledgerPath, segmentsDir } = setup();
  try {
    await segment('beta', {}, {
      transcriptsDir, ledgerPath, segmentsDir,
      model: 'fake-model', completeFn: goodFake,
    });
    expect(existsSync(join(segmentsDir, '101.beta.2026-1-1.txt.json'))).toBe(true);
    expect(existsSync(join(segmentsDir, '000.alpha.2025-8-28.txt.json'))).toBe(false);
  } finally { teardown(root); }
});
