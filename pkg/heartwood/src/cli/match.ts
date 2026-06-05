import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { matchTranscript } from '../reconcile/match';
import type { Claim } from '../transcript/extract';
import type { WikiIndex } from '../wiki/index-schema';
import { config } from '../config';
import type { complete as defaultComplete } from '../llm';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR  = '../content/transcripts';
const LEDGER_PATH      = 'state/processed.json';
const RESOLUTIONS_DIR  = 'state/resolutions';
const MATCHES_DIR      = 'state/matches';
const CONTENT_DIR      = '../content/wiki';
const WIKI_INDEX_PATH  = 'state/wiki-index.json';

export interface MatchCliOptions {
  transcriptsDir?:  string;
  ledgerPath?:      string;
  resolutionsDir?:  string;
  matchesDir?:      string;
  contentDir?:      string;
  wikiIndexPath?:   string;
  model?:           string;
  completeFn?:      typeof defaultComplete;
}

export async function match(
  name: string | undefined,
  flags: { all?: boolean },
  opts: MatchCliOptions = {},
): Promise<void> {
  const transcriptsDir  = opts.transcriptsDir  ?? TRANSCRIPTS_DIR;
  const ledgerPath      = opts.ledgerPath      ?? LEDGER_PATH;
  const resolutionsDir  = opts.resolutionsDir  ?? RESOLUTIONS_DIR;
  const matchesDir      = opts.matchesDir      ?? MATCHES_DIR;
  const contentDir      = opts.contentDir      ?? CONTENT_DIR;
  const wikiIndexPath   = opts.wikiIndexPath   ?? WIKI_INDEX_PATH;

  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);
  let ledger = reconciled;
  if (changes.added.length + changes.rehashed.length > 0) {
    await writeLedger(ledgerPath, ledger);
  }

  const wikiIndex: WikiIndex = JSON.parse(await Bun.file(wikiIndexPath).text());
  const presentFilenames = new Set(files.map((f) => f.filename));
  const model = opts.model ?? config().MODEL_MATCH;
  const ctx = { transcriptsDir, ledgerPath, resolutionsDir, matchesDir, contentDir, model, completeFn: opts.completeFn, wikiIndex };

  if (flags.all) {
    const targets = ledger.entries.filter(
      (e) =>
        presentFilenames.has(e.filename) &&
        e.stages.resolved !== null &&
        e.stages.matched === null,
    );
    if (targets.length === 0) {
      console.log('nothing to match — all extracted transcripts already have stages.matched set');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        ledger = await matchOne(e, ledger, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        ledger = recordError(ledger, e.filename, 'matched', msg);
        await writeLedger(ledgerPath, ledger);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} matched`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed to match`);
    }
    return;
  }

  if (!name) {
    console.error('usage: bun run match <name>');
    console.error('       bun run match --all');
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
  if (r.entry.stages.resolved === null) {
    console.error(`'${r.entry.filename}' has not been resolved — run 'bun run resolve ${name}' first`);
    process.exit(1);
  }
  await matchOne(r.entry, ledger, ctx);
}

export function register(program: Command): void {
  program
    .command('match [name]')
    .description('Match claims to wiki pages')
    .option('--all', 'process all unmatched transcripts')
    .action((n: string | undefined, opts: { all?: boolean }) => match(n, opts));
}

export interface MatchCtx {
  transcriptsDir:  string;
  ledgerPath:      string;
  resolutionsDir:  string;
  matchesDir:      string;
  contentDir:      string;
  model:           string;
  completeFn?:     typeof defaultComplete;
  wikiIndex:       WikiIndex;
  writeLedgerFn?:  (path: string, ledger: Ledger) => Promise<void>;
}

interface ResolutionsFile {
  filename:          string;
  contentHash:       string;
  claimsContentHash: string;
  aliasSuggestions:  unknown[];
  claims:            Claim[];
}

function pageSlug(pagePath: string): string {
  return pagePath.replace(/\.md$/, '').replace(/[/ ]/g, '_');
}

export async function matchOne(
  entry: LedgerEntry,
  ledger: Ledger,
  ctx: MatchCtx,
): Promise<Ledger> {
  // Guard: resolutions file must exist.
  const resolutionsFile = Bun.file(`${ctx.resolutionsDir}/${entry.filename}.json`);
  if (!(await resolutionsFile.exists())) {
    throw new Error(`resolutions file missing — run 'bun run resolve ${entry.filename}' first`);
  }
  const resolutionsData: ResolutionsFile = JSON.parse(await resolutionsFile.text());

  // Guard: transcript must not have changed since resolution.
  if (resolutionsData.contentHash !== entry.contentHash) {
    throw new Error(
      `transcript changed since resolution — run 'bun run transcripts reset ${entry.filename} --stage resolved' then re-resolve before matching`,
    );
  }

  const claims: Claim[] = resolutionsData.claims;

  // Build debug dir for this transcript.
  const debugDir = `${ctx.matchesDir}/_debug/${entry.filename}`;
  await mkdir(debugDir, { recursive: true });

  const result = await matchTranscript(claims, ctx.wikiIndex, {
    model:       ctx.model,
    contentDir:  ctx.contentDir,
    transcript:  entry.filename,
    completeFn:  ctx.completeFn,
    onPageClassified: async (pagePath, claimIndices, rawResults, classifiedResults) => {
      const slug = pageSlug(pagePath);
      const debugPath = `${debugDir}/${slug}.json`;
      const debugTmp  = `${debugPath}.tmp`;
      const debugPayload = { pagePath, claimIndices, rawResults, classifiedResults };
      await Bun.write(debugTmp, JSON.stringify(debugPayload, null, 2) + '\n');
      await rename(debugTmp, debugPath);
    },
  });

  await mkdir(ctx.matchesDir, { recursive: true });
  const outPath = `${ctx.matchesDir}/${entry.filename}.json`;
  const tmpPath = `${outPath}.tmp`;
  const payload = {
    filename:         entry.filename,
    contentHash:      entry.contentHash,
    claimsContentHash: resolutionsData.contentHash,
    stats:            result.stats,
    matches:          result.matches,
  };
  await Bun.write(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  await rename(tmpPath, outPath);

  const next = markStage(ledger, entry.filename, 'matched');
  await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

  const s = result.stats;
  console.log(
    `matched ${entry.filename}: ${s.totalClaims} claims — ${s.standaloneNew} standalone-new,` +
    ` ${s.pagesLoaded} pages loaded (${s.bytesLoaded} bytes),` +
    ` ${s.candidateBatches} candidate batches, ${s.classifierBatches} classifier calls`,
  );
  return next;
}
