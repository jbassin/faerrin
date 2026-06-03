import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { extractTranscript, type ExtractionUnit, type RawClaim, type Claim } from '../transcript/extract';
import type { Segment } from '../transcript/segment';
import { config } from '../config';
import type { complete as defaultComplete } from '../llm';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR = 'transcripts';
const LEDGER_PATH     = 'state/processed.json';
const SEGMENTS_DIR    = 'state/segments';
const CLAIMS_DIR      = 'state/claims';

export interface ExtractCliOptions {
  transcriptsDir?: string;
  ledgerPath?:     string;
  segmentsDir?:    string;
  claimsDir?:      string;
  model?:          string;
  completeFn?:     typeof defaultComplete;
}

export async function extract(
  name: string | undefined,
  flags: { all?: boolean },
  opts: ExtractCliOptions = {},
): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;
  const segmentsDir    = opts.segmentsDir    ?? SEGMENTS_DIR;
  const claimsDir      = opts.claimsDir      ?? CLAIMS_DIR;

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) {
    await writeLedger(ledgerPath, ledger);
  }

  const presentFilenames = new Set(files.map((f) => f.filename));
  const model = opts.model ?? config().MODEL_EXTRACT;
  const worthinessModel = config().MODEL_FILTER;
  const ctx = { transcriptsDir, ledgerPath, segmentsDir, claimsDir, model, worthinessModel, completeFn: opts.completeFn };

  if (flags.all) {
    const targets = ledger.entries.filter(
      (e) =>
        presentFilenames.has(e.filename) &&
        e.stages.segmented !== null &&
        e.stages.extracted === null,
    );
    if (targets.length === 0) {
      console.log('nothing to extract — all segmented transcripts already have stages.extracted set');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        ledger = await extractOne(e, ledger, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        ledger = recordError(ledger, e.filename, 'extracted', msg);
        await writeLedger(ledgerPath, ledger);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} extracted`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed to extract`);
    }
    return;
  }

  if (!name) {
    console.error('usage: bun run extract <name>');
    console.error('       bun run extract --all');
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
  await extractOne(r.entry, ledger, ctx);
}

export function register(program: Command): void {
  program
    .command('extract [name]')
    .description('Extract claims from a segmented transcript')
    .option('--all', 'process all unextracted transcripts')
    .action((n: string | undefined, opts: { all?: boolean }) => extract(n, opts));
}

export interface ExtractCtx {
  transcriptsDir: string;
  ledgerPath:     string;
  segmentsDir:    string;
  claimsDir:      string;
  model:          string;
  worthinessModel: string;
  completeFn?:    typeof defaultComplete;
  writeLedgerFn?: (path: string, ledger: Ledger) => Promise<void>;
}

interface SegmentsFile {
  filename:    string;
  contentHash: string;
  totalLines:  number;
  segments:    Segment[];
}

export async function extractOne(
  entry: LedgerEntry,
  ledger: Ledger,
  ctx: ExtractCtx,
): Promise<Ledger> {
  // Guard: segments file must exist.
  const segPath = `${ctx.segmentsDir}/${entry.filename}.json`;
  const segFile = Bun.file(segPath);
  if (!(await segFile.exists())) {
    throw new Error(
      `segments file missing — run 'bun run segment ${entry.filename}' first`,
    );
  }
  const segData: SegmentsFile = JSON.parse(await segFile.text());

  // Guard: transcript must not have changed since segmentation.
  if (segData.contentHash !== entry.contentHash) {
    throw new Error(
      `transcript changed since segmentation — run 'bun run transcripts reset ${entry.filename} --stage segmented' then re-segment before extracting`,
    );
  }

  const text = await Bun.file(`${ctx.transcriptsDir}/${entry.filename}`).text();

  // Build debug dir per transcript.
  const debugDir = `${ctx.claimsDir}/_debug/${entry.filename}`;
  await mkdir(debugDir, { recursive: true });

  const result = await extractTranscript(text, segData.segments, {
    model:           ctx.model,
    worthinessModel: ctx.worthinessModel,
    transcript:      entry.filename,
    completeFn:      ctx.completeFn,
    onChunkComplete: async (unit: ExtractionUnit, rawClaims: RawClaim[], kept: Claim[]) => {
      const debugPath = `${debugDir}/${unit.startLine}-${unit.endLine}.json`;
      const debugTmp  = `${debugPath}.tmp`;
      const debugPayload = { unit, rawClaims, keptClaims: kept };
      await Bun.write(debugTmp, JSON.stringify(debugPayload, null, 2) + '\n');
      await rename(debugTmp, debugPath);
    },
  });

  // Write pre-worthiness-filter claims for audit.
  const preFilterPath = `${ctx.claimsDir}/_debug/${entry.filename}.json`;
  const preFilterTmp  = `${preFilterPath}.tmp`;
  await Bun.write(preFilterTmp, JSON.stringify({ filename: entry.filename, claims: result.rawClaims }, null, 2) + '\n');
  await rename(preFilterTmp, preFilterPath);

  // Calculate coverage: unique lines covered by extraction units.
  const coveredLines = new Set<number>();
  for (const claim of result.claims) {
    for (let L = claim.lines[0]; L <= claim.lines[1]; L++) {
      coveredLines.add(L);
    }
  }
  // Coverage is based on eligible segment spans, not just claimed lines.
  const eligibleLines = new Set<number>();
  for (const seg of segData.segments) {
    if (['ic', 'recap', 'mixed'].includes(seg.label)) {
      for (let L = seg.startLine; L <= seg.endLine; L++) {
        eligibleLines.add(L);
      }
    }
  }
  const coverageLines = eligibleLines.size;
  const percentOfTranscript = Math.round((coverageLines / segData.totalLines) * 100);

  await mkdir(ctx.claimsDir, { recursive: true });
  const outPath = `${ctx.claimsDir}/${entry.filename}.json`;
  const tmpPath = `${outPath}.tmp`;
  const payload = {
    filename:            entry.filename,
    contentHash:         entry.contentHash,
    segmentsContentHash: segData.contentHash,
    totalLines:          segData.totalLines,
    unitCount:           result.unitCount,
    droppedCount:        result.droppedCount,
    repairedCount:       result.repairedCount,
    filteredCount:       result.filteredCount,
    coverage:            { lines: coverageLines, percentOfTranscript },
    claims:              result.claims,
  };
  await Bun.write(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  await rename(tmpPath, outPath);

  const next = markStage(ledger, entry.filename, 'extracted');
  await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

  const rawCount   = result.rawClaims.length + result.droppedCount;
  const afterRepair = result.rawClaims.length;
  console.log(
    `extracted ${entry.filename}: ${result.claims.length} claims kept` +
    ` (${rawCount} raw → ${afterRepair} player-filtered → ${result.claims.length} after worthiness filter)` +
    `, ${result.repairedCount} repaired, ${result.droppedCount} dropped-invalid`,
  );
  return next;
}
