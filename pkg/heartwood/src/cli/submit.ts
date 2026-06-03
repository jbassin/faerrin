import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { submitOne, type SubmitCtx } from '../gitlab/submit';
import type { GitLabClient } from '../gitlab/client';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR  = '../shared-content/transcripts';
const LEDGER_PATH      = 'state/processed.json';
const PROPOSALS_DIR    = 'state/proposals';
const CONTENT_DIR      = 'content';
const DRY_RUNS_DIR     = 'state/dry-runs';
const SUBMISSIONS_DIR  = 'state/submissions';

export interface SubmitCliOptions {
  transcriptsDir?: string;
  ledgerPath?:     string;
  proposalsDir?:   string;
  contentDir?:     string;
  dryRunsDir?:     string;
  submissionsDir?: string;
  dryRun?:         boolean;
  clientFn?:       (baseUrl: string, token: string, projectId: string) => GitLabClient;
}

export async function submit(
  name: string | undefined,
  flags: { all?: boolean; dryRun?: boolean },
  opts: SubmitCliOptions = {},
): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;
  const proposalsDir   = opts.proposalsDir   ?? PROPOSALS_DIR;
  const contentDir     = opts.contentDir     ?? CONTENT_DIR;
  const dryRunsDir     = opts.dryRunsDir     ?? DRY_RUNS_DIR;
  const submissionsDir = opts.submissionsDir ?? SUBMISSIONS_DIR;

  const dryRun = flags.dryRun ?? opts.dryRun ?? false;

  if (!name && !flags.all) {
    console.error('usage: bun run submit [--dry-run] <name>');
    console.error('       bun run submit [--dry-run] --all');
    process.exit(1);
    return;
  }

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) {
    await writeLedger(ledgerPath, ledger);
  }

  const presentFilenames = new Set(files.map((f) => f.filename));

  const ctx: SubmitCtx = {
    transcriptsDir,
    ledgerPath,
    proposalsDir,
    contentDir,
    dryRunsDir,
    submissionsDir,
    dryRun,
    clientFn: opts.clientFn,
  };

  if (flags.all) {
    const targets = ledger.entries.filter(
      (e) =>
        presentFilenames.has(e.filename) &&
        e.stages.proposed !== null &&
        e.stages.prOpened === null,
    );
    if (targets.length === 0) {
      console.log('nothing to submit — all proposed transcripts already have stages.prOpened set');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        ledger = await submitOne(e, ledger, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} submitted`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed to submit`);
    }
    return;
  }

  const r = findEntry(ledger, name!);
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
  if (r.entry.stages.proposed === null) {
    console.error(`'${r.entry.filename}' has not been proposed — run 'bun run propose ${name}' first`);
    process.exit(1);
  }
  await submitOne(r.entry, ledger, ctx);
}

export function register(program: Command): void {
  program
    .command('submit [name]')
    .description('Submit edit proposals to GitLab as a merge request')
    .option('--all',     'process all eligible transcripts')
    .option('--dry-run', 'write dry-run file instead of opening MR')
    .action((n: string | undefined, opts: { all?: boolean; dryRun?: boolean }) => submit(n, opts));
}
