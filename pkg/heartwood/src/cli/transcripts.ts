import { discoverTranscripts, parseFilename } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  resetEntry, resetEntryStage,
  STAGE_ORDER, type Ledger, type LedgerEntry, type Stage,
} from '../transcript/ledger';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR = '../content/transcripts';
const LEDGER_PATH     = 'state/processed.json';

export interface TranscriptsCliOptions {
  transcriptsDir?: string;
  ledgerPath?: string;
}

export async function transcriptsList(opts: TranscriptsCliOptions = {}): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  const reconcileChanged = changes.added.length + changes.rehashed.length > 0;
  if (reconcileChanged) await writeLedger(ledgerPath, reconciled);
  printList(reconciled, new Set(files.map((f) => f.filename)));
}

export async function transcriptsStatus(
  name: string,
  opts: TranscriptsCliOptions = {},
): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  const reconcileChanged = changes.added.length + changes.rehashed.length > 0;
  if (reconcileChanged) await writeLedger(ledgerPath, reconciled);

  const r = findEntry(reconciled, name);
  if (!r.ok) { printFindFailure(r, name); process.exit(1); }
  printStatus(r.entry);
}

export async function transcriptsReset(
  name: string,
  flags: { stage?: string },
  opts: TranscriptsCliOptions = {},
): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled } = reconcile(prior, files);

  const stage = flags.stage;
  if (stage && !(STAGE_ORDER as readonly string[]).includes(stage)) {
    console.error(`unknown stage: ${stage}. Known: ${STAGE_ORDER.join(', ')}`);
    process.exit(1);
  }

  const r = findEntry(reconciled, name);
  if (!r.ok) { printFindFailure(r, name); process.exit(1); }
  const after = stage
    ? resetEntryStage(reconciled, r.entry.filename, stage as Stage)
    : resetEntry(reconciled, r.entry.filename);
  await writeLedger(ledgerPath, after);
  console.log(stage
    ? `reset ${r.entry.filename} from stage '${stage}' (cascade)`
    : `reset ${r.entry.filename} (all stages)`);
}

export function register(program: Command): void {
  const cmd = program
    .command('transcripts')
    .description('Manage the transcript ledger');

  cmd.command('list')
    .description('List all known transcripts and their pipeline stages')
    .action(() => transcriptsList());

  cmd.command('status <name>')
    .description('Show stage status for a transcript')
    .action((name: string) => transcriptsStatus(name));

  cmd.command('reset <name>')
    .description('Reset a transcript to a prior stage')
    .option('--stage <stage>', `stage to reset to (${STAGE_ORDER.join(', ')})`)
    .action((name: string, opts: { stage?: string }) => transcriptsReset(name, opts));
}

function printFindFailure(r: Exclude<ReturnType<typeof findEntry>, { ok: true }>, name: string): void {
  if (r.reason === 'not_found') {
    console.error(`no transcript matches '${name}'`);
  } else {
    console.error(`'${name}' is ambiguous — matches:`);
    for (const c of r.candidates) console.error(`  ${c}`);
  }
}

function printList(ledger: Ledger, present: Set<string>): void {
  const rows = ledger.entries.map((e) => {
    const parsed = parseFilename(e.filename);
    return { entry: e, parsed, missing: !present.has(e.filename) };
  });

  rows.sort((a, b) => {
    if (!a.parsed && !b.parsed) return a.entry.filename.localeCompare(b.entry.filename);
    if (!a.parsed) return 1;
    if (!b.parsed) return -1;
    return a.parsed.campaignId - b.parsed.campaignId
      || a.parsed.sessionDate.localeCompare(b.parsed.sessionDate);
  });

  const stageHeaders = STAGE_ORDER.map((s) => s.slice(0, 3));
  const header = ['ID', 'Campaign', 'Date', ...stageHeaders, 'PR'];
  const dataRows = rows.map((r) => {
    const id   = r.parsed ? r.parsed.campaignId.toString().padStart(3, '0') : '?';
    const camp = (r.parsed?.campaignName ?? r.entry.filename) + (r.missing ? ' (missing)' : '');
    const date = r.parsed?.sessionDate ?? '';
    const stageCells = STAGE_ORDER.map((s) => {
      const hasError = r.entry.errors.some((e) => e.stage === s);
      if (hasError) return '!';
      return r.entry.stages[s] ? '✓' : '·';
    });
    const pr = r.entry.prUrl ? '✓' : '';
    return [id, camp, date, ...stageCells, pr];
  });

  const all = [header, ...dataRows];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i]!.length)));
  const fmt = (row: string[]) => row.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(fmt(header));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of dataRows) console.log(fmt(row));

  const main = rows.filter((r) => r.parsed?.isMain && !r.missing).length;
  const side = rows.filter((r) => r.parsed && !r.parsed.isMain && !r.missing).length;
  console.log(`\n${rows.length} ledger entries; ${main} main + ${side} side currently on disk`);
}

function printStatus(entry: LedgerEntry): void {
  console.log(`filename:    ${entry.filename}`);
  console.log(`contentHash: ${entry.contentHash}`);
  console.log(`prUrl:       ${entry.prUrl ?? '(none)'}`);
  console.log('stages:');
  for (const s of STAGE_ORDER) {
    console.log(`  ${s.padEnd(10)} ${entry.stages[s] ?? '(pending)'}`);
  }
  console.log(`errors: ${entry.errors.length}`);
  for (const e of entry.errors) {
    console.log(`  [${e.ts}] ${e.stage}: ${e.message}`);
  }
}
