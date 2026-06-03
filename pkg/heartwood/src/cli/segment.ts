import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { segmentTranscript } from '../transcript/segment';
import { config } from '../config';
import type { complete as defaultComplete } from '../llm';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR = '../shared-content/transcripts';
const LEDGER_PATH     = 'state/processed.json';
const SEGMENTS_DIR    = 'state/segments';

export interface SegmentCliOptions {
  transcriptsDir?: string;
  ledgerPath?: string;
  segmentsDir?: string;
  model?: string;                       // overrides config().MODEL_SEGMENT; primarily for tests
  completeFn?: typeof defaultComplete;  // primarily for tests
}

export async function segment(
  name: string | undefined,
  flags: { all?: boolean },
  opts: SegmentCliOptions = {},
): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;
  const segmentsDir    = opts.segmentsDir    ?? SEGMENTS_DIR;

  // Reconcile ledger against discovery first so we operate on fresh state.
  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) {
    await writeLedger(ledgerPath, ledger);
  }

  const presentFilenames = new Set(files.map((f) => f.filename));
  const model = opts.model ?? config().MODEL_SEGMENT;
  const ctx = { transcriptsDir, ledgerPath, segmentsDir, model, completeFn: opts.completeFn };

  if (flags.all) {
    const targets = ledger.entries.filter(
      (e) => presentFilenames.has(e.filename) && e.stages.segmented === null,
    );
    if (targets.length === 0) {
      console.log('nothing to segment — all on-disk transcripts already have stages.segmented set');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        ledger = await segmentOne(e, ledger, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        ledger = recordError(ledger, e.filename, 'segmented', msg);
        await writeLedger(ledgerPath, ledger);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} segmented`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed to segment`);
    }
    return;
  }

  if (!name) {
    console.error('usage: bun run segment <name>');
    console.error('       bun run segment --all');
    process.exit(1);
    return;
  }

  const r = findEntry(ledger, name);
  if (!r.ok) {
    if (r.reason === 'not_found') {
      console.error(`no transcript matches '${name}'`);
    } else {
      console.error(`'${name}' is ambiguous — matches:`);
      for (const c of r.candidates) console.error(`  ${c}`);
    }
    process.exit(1);
  }
  if (!presentFilenames.has(r.entry.filename)) {
    console.error(`'${r.entry.filename}' is in the ledger but no file exists on disk`);
    process.exit(1);
  }
  await segmentOne(r.entry, ledger, ctx);
}

export interface SegmentCtx {
  transcriptsDir: string;
  ledgerPath:     string;
  segmentsDir:    string;
  model:          string;
  completeFn?:    typeof defaultComplete;
  writeLedgerFn?: (path: string, ledger: Ledger) => Promise<void>;
}

export async function segmentOne(
  entry: LedgerEntry,
  ledger: Ledger,
  ctx:    SegmentCtx,
): Promise<Ledger> {
  const text = await Bun.file(`${ctx.transcriptsDir}/${entry.filename}`).text();
  const result = await segmentTranscript(text, {
    model:      ctx.model,
    transcript: entry.filename,
    completeFn: ctx.completeFn,
  });

  await mkdir(ctx.segmentsDir, { recursive: true });
  const outPath = `${ctx.segmentsDir}/${entry.filename}.json`;
  const tmpPath = `${outPath}.tmp`;
  const payload = {
    filename:    entry.filename,
    contentHash: entry.contentHash,
    totalLines:  result.totalLines,
    windowCount: result.windowCount,
    segments:    result.segments,
  };
  await Bun.write(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  await rename(tmpPath, outPath);

  const next = markStage(ledger, entry.filename, 'segmented');
  await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

  const counts: Record<string, number> = {};
  for (const s of result.segments) counts[s.label] = (counts[s.label] ?? 0) + 1;
  const breakdown = Object.entries(counts).sort().map(([k, v]) => `${v} ${k}`).join(', ');
  const refinedSuffix = result.refinedCount > 0 ? ` — ${result.refinedCount} mixed blocks refined` : '';
  console.log(`segmented ${entry.filename}: ${result.segments.length} segments (${breakdown})${refinedSuffix}`);
  return next;
}

export function register(program: Command): void {
  program
    .command('segment [name]')
    .description('Segment a transcript into labeled scenes')
    .option('--all', 'process all unsegmented transcripts')
    .action((n: string | undefined, opts: { all?: boolean }) => segment(n, opts));
}
