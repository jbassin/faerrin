import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { resolveTranscript, type AliasSuggestion } from '../reconcile/resolve';
import type { Claim } from '../transcript/extract';
import type { WikiIndex } from '../wiki/index-schema';
import { config } from '../config';
import type { complete as defaultComplete } from '../llm';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR  = '../shared-content/transcripts';
const LEDGER_PATH      = 'state/processed.json';
const CLAIMS_DIR       = 'state/claims';
const RESOLUTIONS_DIR  = 'state/resolutions';
const WIKI_INDEX_PATH  = 'state/wiki-index.json';

export interface ResolveCliOptions {
  transcriptsDir?:  string;
  ledgerPath?:      string;
  claimsDir?:       string;
  resolutionsDir?:  string;
  wikiIndexPath?:   string;
  model?:           string;
  completeFn?:      typeof defaultComplete;
}

export async function resolve(
  name: string | undefined,
  flags: { all?: boolean },
  opts: ResolveCliOptions = {},
): Promise<void> {
  const transcriptsDir  = opts.transcriptsDir  ?? TRANSCRIPTS_DIR;
  const ledgerPath      = opts.ledgerPath      ?? LEDGER_PATH;
  const claimsDir       = opts.claimsDir       ?? CLAIMS_DIR;
  const resolutionsDir  = opts.resolutionsDir  ?? RESOLUTIONS_DIR;
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
  const model = opts.model ?? config().MODEL_RESOLVE;
  const ctx = { transcriptsDir, ledgerPath, claimsDir, resolutionsDir, model, completeFn: opts.completeFn, wikiIndex };

  if (flags.all) {
    const targets = ledger.entries.filter(
      (e) =>
        presentFilenames.has(e.filename) &&
        e.stages.extracted !== null &&
        e.stages.resolved === null,
    );
    if (targets.length === 0) {
      console.log('nothing to resolve — all extracted transcripts already have stages.resolved set');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        ledger = await resolveOne(e, ledger, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        ledger = recordError(ledger, e.filename, 'resolved', msg);
        await writeLedger(ledgerPath, ledger);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} resolved`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed to resolve`);
    }
    return;
  }

  if (!name) {
    console.error('usage: bun run resolve <name>');
    console.error('       bun run resolve --all');
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
  if (r.entry.stages.extracted === null) {
    console.error(`'${r.entry.filename}' has not been extracted — run 'bun run extract ${name}' first`);
    process.exit(1);
  }
  await resolveOne(r.entry, ledger, ctx);
}

export function register(program: Command): void {
  program
    .command('resolve [name]')
    .description('Resolve entity names in extracted claims against the wiki')
    .option('--all', 'process all unresolved transcripts')
    .action((n: string | undefined, opts: { all?: boolean }) => resolve(n, opts));
}

export interface ResolveCtx {
  transcriptsDir:  string;
  ledgerPath:      string;
  claimsDir:       string;
  resolutionsDir:  string;
  model:           string;
  completeFn?:     typeof defaultComplete;
  wikiIndex:       WikiIndex;
  writeLedgerFn?:  (path: string, ledger: Ledger) => Promise<void>;
}

interface ClaimsFile {
  filename:    string;
  contentHash: string;
  claims:      Claim[];
}

export async function resolveOne(
  entry: LedgerEntry,
  ledger: Ledger,
  ctx: ResolveCtx,
): Promise<Ledger> {
  // Guard: claims file must exist.
  const claimsFile = Bun.file(`${ctx.claimsDir}/${entry.filename}.json`);
  if (!(await claimsFile.exists())) {
    throw new Error(`claims file missing — run 'bun run extract ${entry.filename}' first`);
  }
  const claimsData: ClaimsFile = JSON.parse(await claimsFile.text());

  // Guard: transcript must not have changed since extraction.
  if (claimsData.contentHash !== entry.contentHash) {
    throw new Error(
      `transcript changed since extraction — run 'bun run transcripts reset ${entry.filename} --stage extracted' then re-extract before resolving`,
    );
  }

  const result = await resolveTranscript(claimsData.claims, ctx.wikiIndex, {
    model:      ctx.model,
    transcript: entry.filename,
    completeFn: ctx.completeFn,
  });

  await mkdir(ctx.resolutionsDir, { recursive: true });
  const outPath = `${ctx.resolutionsDir}/${entry.filename}.json`;
  const tmpPath = `${outPath}.tmp`;
  const payload = {
    filename:          entry.filename,
    contentHash:       entry.contentHash,
    claimsContentHash: claimsData.contentHash,
    resolvedCount:     result.resolvedCount,
    suggestionCount:   result.suggestionCount,
    aliasSuggestions:  result.aliasSuggestions as AliasSuggestion[],
    claims:            result.claims,
  };
  await Bun.write(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  await rename(tmpPath, outPath);

  const next = markStage(ledger, entry.filename, 'resolved');
  await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

  const exactCount = result.claims
    .flatMap((c) => c.entityResolutions)
    .filter((r) => r.method === 'exact').length;
  const llmCount = result.resolvedCount;

  console.log(
    `resolved ${entry.filename}: ${claimsData.claims.length} claims,` +
    ` ${exactCount} exact + ${llmCount} via LLM entity resolutions,` +
    ` ${result.suggestionCount} alias suggestions`,
  );
  return next;
}
