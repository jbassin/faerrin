import { mkdir } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry, resetEntryStage,
  type Ledger, type LedgerEntry, type Stages,
} from '../transcript/ledger';
import type { Command } from 'commander';
import { segmentOne, type SegmentCtx } from './segment';
import { extractOne, type ExtractCtx } from './extract';
import { resolveOne, type ResolveCtx } from './resolve';
import { matchOne, type MatchCtx } from './match';
import { proposeOne, type ProposeCtx } from './propose';
import { submitOne } from '../github/submit';
import type { SubmitCtx } from '../github/submit';
import type { GitHubClient } from '../github/client';
import type { WikiIndex } from '../wiki/index-schema';
import type { complete as defaultComplete } from '../llm';
import { config } from '../config';
import { currentRunFile, summarize } from '../log';

// ---- Public types ----

export type PipelineStage =
  'segment' | 'extract' | 'resolve' | 'match' | 'propose' | 'submit';

export const PIPELINE_STAGES: PipelineStage[] =
  ['segment', 'extract', 'resolve', 'match', 'propose', 'submit'];

export interface ProcessCliOptions {
  transcriptsDir?: string;
  ledgerPath?:     string;
  segmentsDir?:    string;
  claimsDir?:      string;
  resolutionsDir?: string;
  matchesDir?:     string;
  proposalsDir?:   string;
  contentDir?:     string;
  dryRunsDir?:     string;
  submissionsDir?: string;
  wikiIndexPath?:  string;
  claudeMdPath?:   string;
  models?: {
    segment?: string;
    extract?: string;
    resolve?: string;
    match?:   string;
    propose?: string;
  };
  completeFn?: typeof defaultComplete;
  clientFn?:   (apiUrl: string, token: string, repo: string) => GitHubClient;
  // Injected wiki index (skips disk read; used in tests)
  wikiIndex?: WikiIndex;
}

// ---- Internal types ----

type WriteLedgerFn = (path: string, ledger: Ledger) => Promise<void>;

const STAGE_LEDGER_KEY: Record<PipelineStage, keyof Stages> = {
  segment: 'segmented',
  extract: 'extracted',
  resolve: 'resolved',
  match:   'matched',
  propose: 'proposed',
  submit:  'verified',
};

export interface ProcessFlags {
  all?:         boolean;
  dryRun?:      boolean;
  force?:       string;
  stopBefore?:  string;
  concurrency?: number;
}

interface ResolvedCtx {
  ledgerPath:     string;
  transcriptsDir: string;
  segCtx:         Omit<SegmentCtx, 'writeLedgerFn'>;
  extCtx:         Omit<ExtractCtx, 'writeLedgerFn'>;
  resCtx:         Omit<ResolveCtx, 'writeLedgerFn'>;
  matchCtx:       Omit<MatchCtx, 'writeLedgerFn'>;
  propCtx:        Omit<ProposeCtx, 'writeLedgerFn'>;
  submitCtx:      Omit<SubmitCtx, 'dryRun' | 'writeLedgerFn'>;
}

// ---- Stage completion check ----

function isStageComplete(entry: LedgerEntry, stage: PipelineStage): boolean {
  if (stage === 'submit') return entry.stages.prOpened !== null;
  return entry.stages[STAGE_LEDGER_KEY[stage]] !== null;
}

// ---- LedgerMutex ----

export class LedgerMutex {
  private queue: Promise<void> = Promise.resolve();

  makeWriter(ledgerPath: string, filename: string): WriteLedgerFn {
    return (path: string, incoming: Ledger): Promise<void> => {
      const step = this.queue.then(async () => {
        const current = await readLedger(path);
        const updated = incoming.entries.find((e) => e.filename === filename);
        const merged: Ledger = {
          entries: current.entries.map((e) =>
            e.filename === filename && updated ? updated : e,
          ),
        };
        await writeLedger(path, merged);
      });
      this.queue = step.catch(() => {});
      return step;
    };
  }
}

// ---- Context builder ----

async function buildCtx(opts: ProcessCliOptions): Promise<ResolvedCtx> {
  const transcriptsDir = opts.transcriptsDir ?? '../content/transcripts';
  const ledgerPath     = opts.ledgerPath     ?? 'state/processed.json';
  const segmentsDir    = opts.segmentsDir    ?? 'state/segments';
  const claimsDir      = opts.claimsDir      ?? 'state/claims';
  const resolutionsDir = opts.resolutionsDir ?? 'state/resolutions';
  const matchesDir     = opts.matchesDir     ?? 'state/matches';
  const proposalsDir   = opts.proposalsDir   ?? 'state/proposals';
  const contentDir     = opts.contentDir     ?? 'content';
  const dryRunsDir     = opts.dryRunsDir     ?? 'state/dry-runs';
  const submissionsDir = opts.submissionsDir ?? 'state/submissions';
  const wikiIndexPath  = opts.wikiIndexPath  ?? 'state/wiki-index.json';
  const claudeMdPath   = opts.claudeMdPath   ?? 'CLAUDE.md';

  let wikiIndex: WikiIndex;
  if (opts.wikiIndex) {
    wikiIndex = opts.wikiIndex;
  } else {
    const cfg = config();
    wikiIndex = JSON.parse(await Bun.file(wikiIndexPath).text()) as WikiIndex;
    void cfg; // config() validates env vars; wikiIndex loaded above
  }

  // config() call is deferred to avoid crashing in tests that inject wikiIndex
  const getModel = (key: keyof NonNullable<ProcessCliOptions['models']>) => {
    try {
      const cfg = config();
      const modelMap: Record<string, string> = {
        segment: cfg.MODEL_SEGMENT,
        extract: cfg.MODEL_EXTRACT,
        resolve: cfg.MODEL_RESOLVE,
        match:   cfg.MODEL_MATCH,
        propose: cfg.MODEL_PROPOSE,
      };
      return opts.models?.[key] ?? modelMap[key] ?? '';
    } catch {
      return opts.models?.[key] ?? 'test-model';
    }
  };

  const getFilterModel = () => {
    try { return config().MODEL_FILTER; } catch { return 'test-model'; }
  };

  return {
    ledgerPath,
    transcriptsDir,
    segCtx: {
      transcriptsDir,
      ledgerPath,
      segmentsDir,
      model:      getModel('segment'),
      completeFn: opts.completeFn,
    },
    extCtx: {
      transcriptsDir,
      ledgerPath,
      segmentsDir,
      claimsDir,
      model:           getModel('extract'),
      worthinessModel: getFilterModel(),
      completeFn:      opts.completeFn,
    },
    resCtx: {
      transcriptsDir,
      ledgerPath,
      claimsDir,
      resolutionsDir,
      model:      getModel('resolve'),
      completeFn: opts.completeFn,
      wikiIndex,
    },
    matchCtx: {
      transcriptsDir,
      ledgerPath,
      resolutionsDir,
      matchesDir,
      contentDir,
      model:      getModel('match'),
      completeFn: opts.completeFn,
      wikiIndex,
    },
    propCtx: {
      transcriptsDir,
      ledgerPath,
      resolutionsDir,
      matchesDir,
      segmentsDir,
      proposalsDir,
      contentDir,
      wikiIndexPath,
      claudeMdPath,
      model:      getModel('propose'),
      completeFn: opts.completeFn,
      wikiIndex,
    },
    submitCtx: {
      transcriptsDir,
      ledgerPath,
      proposalsDir,
      contentDir,
      dryRunsDir,
      submissionsDir,
      clientFn: opts.clientFn,
    },
  };
}

// ---- getTargets ----

export function getTargets(
  entries:          LedgerEntry[],
  presentFilenames: Set<string>,
  stopBefore?:      PipelineStage,
): LedgerEntry[] {
  const limit = stopBefore ? PIPELINE_STAGES.indexOf(stopBefore) : PIPELINE_STAGES.length;
  const stagesToRun = PIPELINE_STAGES.slice(0, limit);
  if (stagesToRun.length === 0) return [];
  return entries.filter(
    (e) =>
      presentFilenames.has(e.filename) &&
      stagesToRun.some((s) => !isStageComplete(e, s)),
  );
}

// ---- runWithConcurrency ----

async function runWithConcurrency<T>(
  items:       T[],
  concurrency: number,
  fn:          (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

// ---- buildSummary ----

async function buildSummary(
  targets:    LedgerEntry[],
  failures:   Array<{ filename: string; error: string }>,
  ledgerPath: string,
): Promise<string> {
  const ledger = await readLedger(ledgerPath);
  const ts = new Date().toISOString();

  const runFile = currentRunFile();
  const rollup = (await Bun.file(runFile).exists()) ? await summarize(runFile) : null;

  const failureSet = new Set(failures.map((f) => f.filename));
  const lines: string[] = [`# Process-All Run — ${ts}\n`];

  lines.push('## Transcripts\n');
  lines.push('| Transcript | Result | PR |');
  lines.push('|---|---|---|');
  for (const t of targets) {
    const entry = ledger.entries.find((e) => e.filename === t.filename);
    const failed = failureSet.has(t.filename);
    const result = failed ? '✗ failed' : '✓';
    const pr = entry?.prUrl ? `[PR](${entry.prUrl})` : '—';
    lines.push(`| ${t.filename} | ${result} | ${pr} |`);
  }

  if (rollup) {
    lines.push('\n## Cost\n');
    lines.push('| Stage | Model | Calls | Cost |');
    lines.push('|---|---|---|---|');
    for (const [key, b] of Object.entries(rollup.byStage).sort()) {
      const [stage, model] = key.split('::');
      lines.push(`| ${stage} | ${model} | ${b.calls} | $${b.costUSD.toFixed(4)} |`);
    }
    lines.push(`| **TOTAL** | | ${rollup.totals.calls} | **$${rollup.totals.costUSD.toFixed(4)}** |`);
  }

  if (failures.length > 0) {
    lines.push('\n## Errors\n');
    for (const f of failures) lines.push(`- \`${f.filename}\`: ${f.error}`);
  }

  const succeeded = targets.length - failures.length;
  const mrCount = targets.filter((t) => {
    const e = ledger.entries.find((e) => e.filename === t.filename);
    return e?.prUrl;
  }).length;
  lines.push(`\n---\n`);
  lines.push(`${targets.length} targeted · ${succeeded} succeeded · ${failures.length} failed · ${mrCount} MRs opened`);
  if (rollup) lines.push(`Total cost: $${rollup.totals.costUSD.toFixed(4)}`);

  return lines.join('\n') + '\n';
}

// ---- processOneTranscript (exported for testing) ----

export async function processOneTranscript(
  filename:      string,
  args:          Pick<ProcessFlags, 'dryRun' | 'stopBefore'>,
  ctx:           ResolvedCtx,
  writeLedgerFn: WriteLedgerFn,
): Promise<void> {
  for (const stage of PIPELINE_STAGES) {
    if (args.stopBefore === stage) return;

    const ledger = await readLedger(ctx.ledgerPath);
    const r = findEntry(ledger, filename);
    if (!r.ok) throw new Error(`transcript not found in ledger: ${filename}`);
    if (isStageComplete(r.entry, stage)) continue;

    switch (stage) {
      case 'segment': await segmentOne(r.entry, ledger, { ...ctx.segCtx, writeLedgerFn }); break;
      case 'extract': await extractOne(r.entry, ledger, { ...ctx.extCtx, writeLedgerFn }); break;
      case 'resolve': await resolveOne(r.entry, ledger, { ...ctx.resCtx, writeLedgerFn }); break;
      case 'match':   await matchOne(r.entry, ledger, { ...ctx.matchCtx, writeLedgerFn }); break;
      case 'propose': await proposeOne(r.entry, ledger, { ...ctx.propCtx, writeLedgerFn }); break;
      case 'submit':  await submitOne(r.entry, ledger, { ...ctx.submitCtx, dryRun: args.dryRun ?? false, writeLedgerFn }); break;
    }
  }
}

// ---- Unified CLI handler ----

export async function process(
  name: string | undefined,
  flags: ProcessFlags,
  opts: ProcessCliOptions = {},
): Promise<void> {
  if (!name && !flags.all) {
    console.error('usage: bun run process <name> [--dry-run] [--force <stage>] [--stop-before <stage>]');
    console.error('       bun run process --all [--dry-run] [--stop-before <stage>] [--concurrency <n>]');
    globalThis.process.exit(1);
    return;
  }
  if (name && flags.all) {
    console.error('cannot combine a transcript name with --all');
    globalThis.process.exit(1);
    return;
  }
  if (!flags.all && flags.concurrency && flags.concurrency > 1) {
    console.error('--concurrency is only valid with --all');
    globalThis.process.exit(1);
    return;
  }
  if (flags.all && flags.force) {
    console.error('--force is not allowed with --all');
    globalThis.process.exit(1);
    return;
  }

  const force = flags.force as PipelineStage | undefined;
  const stopBefore = flags.stopBefore as PipelineStage | undefined;
  const dryRun = flags.dryRun ?? false;
  const concurrency = flags.concurrency ?? 1;

  if (force && !PIPELINE_STAGES.includes(force)) {
    console.error(`--force requires a valid stage: ${PIPELINE_STAGES.join(', ')}`);
    globalThis.process.exit(1);
    return;
  }
  if (stopBefore && !PIPELINE_STAGES.includes(stopBefore)) {
    console.error(`--stop-before requires a valid stage: ${PIPELINE_STAGES.join(', ')}`);
    globalThis.process.exit(1);
    return;
  }

  const ctx = await buildCtx(opts);

  const prior = await readLedger(ctx.ledgerPath);
  const { files, skipped } = await discoverTranscripts(ctx.transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) await writeLedger(ctx.ledgerPath, ledger);

  if (name) {
    // Single-transcript mode
    const r = findEntry(ledger, name);
    if (!r.ok) {
      if (r.reason === 'not_found') {
        console.error(`no transcript matches '${name}'`);
      } else {
        console.error(`'${name}' is ambiguous — matches:`);
        for (const c of r.candidates) console.error(`  ${c}`);
      }
      globalThis.process.exit(1);
      return;
    }

    const presentFilenames = new Set(files.map((f) => f.filename));
    if (!presentFilenames.has(r.entry.filename)) {
      console.error(`'${r.entry.filename}' is in the ledger but no file exists on disk`);
      globalThis.process.exit(1);
      return;
    }

    if (force) {
      ledger = resetEntryStage(ledger, r.entry.filename, STAGE_LEDGER_KEY[force]);
      await writeLedger(ctx.ledgerPath, ledger);
      console.log(`forced: reset '${r.entry.filename}' from stage '${force}'`);
    }

    const mutex = new LedgerMutex();
    const writeLedgerFn = mutex.makeWriter(ctx.ledgerPath, r.entry.filename);
    await processOneTranscript(r.entry.filename, { dryRun, stopBefore }, ctx, writeLedgerFn);
    return;
  }

  // --all mode
  const presentFilenames = new Set(files.map((f) => f.filename));
  const targets = getTargets(ledger.entries, presentFilenames, stopBefore);

  if (targets.length === 0) {
    console.log('nothing to process — all transcripts are up to date');
    return;
  }
  console.log(`processing ${targets.length} transcript(s) with concurrency ${concurrency}`);

  const mutex = new LedgerMutex();
  const failures: Array<{ filename: string; error: string }> = [];

  await runWithConcurrency(targets, concurrency, async (entry) => {
    const writeLedgerFn = mutex.makeWriter(ctx.ledgerPath, entry.filename);
    try {
      await processOneTranscript(entry.filename, { dryRun, stopBefore }, ctx, writeLedgerFn);
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`! ${entry.filename}: ${msg}`);
      failures.push({ filename: entry.filename, error: msg });
    }
  });

  await mkdir('state/runs', { recursive: true });
  const summary = await buildSummary(targets, failures, ctx.ledgerPath);
  const summaryPath = currentRunFile().replace('.jsonl', '-summary.md');
  await Bun.write(summaryPath, summary);
  console.log(`\nsummary: ${summaryPath}`);
  console.log(summary);

  if (failures.length > 0) {
    throw new Error(`${failures.length} transcript(s) failed`);
  }
}

export function register(program: Command): void {
  program
    .command('process [name]')
    .description('Run the full pipeline for one transcript or all')
    .option('--all',                 'process all eligible transcripts')
    .option('--dry-run',             'skip actual GitHub submission')
    .option('--force <stage>',       `re-run from this stage (${PIPELINE_STAGES.join(', ')})`)
    .option('--stop-before <stage>', 'halt pipeline before this stage')
    .option('--concurrency <n>',     'parallel workers (--all only)', (v) => parseInt(v, 10), 1)
    .action((n: string | undefined, opts: ProcessFlags) => process(n, opts));
}
