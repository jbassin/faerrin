import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  type Ledger,
} from '../transcript/ledger';
import { respondOne, type RespondCtx } from '../github/respond';
import type { GitHubClient } from '../github/client';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR  = '../shared-content/transcripts';
const LEDGER_PATH      = 'state/processed.json';
const SUBMISSIONS_DIR  = 'state/submissions';
const PROPOSALS_DIR    = 'state/proposals';
const CONTENT_DIR      = '../shared-content/wiki';
const DRY_RUNS_DIR     = 'state/dry-runs';
const CONVENTIONS_PATH = 'CLAUDE.md';

export interface RespondCliOptions {
  transcriptsDir?:  string;
  ledgerPath?:      string;
  submissionsDir?:  string;
  proposalsDir?:    string;
  contentDir?:      string;
  conventionsPath?: string;
  clientFn?:        (apiUrl: string, token: string, repo: string) => GitHubClient;
}

export async function respond(
  name: string | undefined,
  flags: { all?: boolean },
  opts: RespondCliOptions = {},
): Promise<void> {
  const transcriptsDir  = opts.transcriptsDir  ?? TRANSCRIPTS_DIR;
  const ledgerPath      = opts.ledgerPath      ?? LEDGER_PATH;
  const submissionsDir  = opts.submissionsDir  ?? SUBMISSIONS_DIR;
  const proposalsDir    = opts.proposalsDir    ?? PROPOSALS_DIR;
  const contentDir      = opts.contentDir      ?? CONTENT_DIR;
  const conventionsPath = opts.conventionsPath ?? CONVENTIONS_PATH;

  if (!name && !flags.all) {
    console.error('usage: bun run respond <name>');
    console.error('       bun run respond --all');
    process.exit(1);
    return;
  }

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger: Ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) {
    await writeLedger(ledgerPath, ledger);
  }

  const ctx: RespondCtx = {
    ledgerPath,
    submissionsDir,
    proposalsDir,
    contentDir,
    transcriptsDir,
    conventionsPath,
    clientFn: opts.clientFn,
  };

  if (flags.all) {
    const targets = ledger.entries.filter((e) => e.stages.prOpened !== null);
    if (targets.length === 0) {
      console.log('nothing to respond — no transcripts with open MRs');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        await respondOne(e, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} processed`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed`);
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
  if (r.entry.stages.prOpened === null) {
    console.error(`'${r.entry.filename}' has no open PR — run 'bun run submit ${name}' first`);
    process.exit(1);
  }
  await respondOne(r.entry, ctx);
}

export function register(program: Command): void {
  program
    .command('respond [name]')
    .description('Post responses to PR reviewer comments')
    .option('--all', 'process all eligible transcripts')
    .action((n: string | undefined, opts: { all?: boolean }) => respond(n, opts));
}
