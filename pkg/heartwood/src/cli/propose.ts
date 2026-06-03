import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { proposeTranscript } from '../reconcile/propose';
import type { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import type { Segment } from '../transcript/segment';
import type { AliasSuggestion } from '../reconcile/resolve';
import type { MatchEntry } from '../reconcile/match';
import type { Cluster, AliasEditCluster, UpdateCluster, CreateCluster } from '../reconcile/cluster';
import type { Proposal } from '../reconcile/propose';
import { config } from '../config';
import type { Command } from 'commander';

const TRANSCRIPTS_DIR  = '../shared-content/transcripts';
const LEDGER_PATH      = 'state/processed.json';
const RESOLUTIONS_DIR  = 'state/resolutions';
const MATCHES_DIR      = 'state/matches';
const SEGMENTS_DIR     = 'state/segments';
const PROPOSALS_DIR    = 'state/proposals';
const CONTENT_DIR      = 'content';
const WIKI_INDEX_PATH  = 'state/wiki-index.json';
const CLAUDE_MD_PATH   = 'CLAUDE.md';

export interface ProposeCliOptions {
  transcriptsDir?:  string;
  ledgerPath?:      string;
  resolutionsDir?:  string;
  matchesDir?:      string;
  segmentsDir?:     string;
  proposalsDir?:    string;
  contentDir?:      string;
  wikiIndexPath?:   string;
  claudeMdPath?:    string;
  model?:           string;
  completeFn?:      typeof defaultComplete;
}

export async function propose(
  name: string | undefined,
  flags: { all?: boolean },
  opts: ProposeCliOptions = {},
): Promise<void> {
  const transcriptsDir  = opts.transcriptsDir  ?? TRANSCRIPTS_DIR;
  const ledgerPath      = opts.ledgerPath      ?? LEDGER_PATH;
  const resolutionsDir  = opts.resolutionsDir  ?? RESOLUTIONS_DIR;
  const matchesDir      = opts.matchesDir      ?? MATCHES_DIR;
  const segmentsDir     = opts.segmentsDir     ?? SEGMENTS_DIR;
  const proposalsDir    = opts.proposalsDir    ?? PROPOSALS_DIR;
  const contentDir      = opts.contentDir      ?? CONTENT_DIR;
  const wikiIndexPath   = opts.wikiIndexPath   ?? WIKI_INDEX_PATH;
  const claudeMdPath    = opts.claudeMdPath    ?? CLAUDE_MD_PATH;

  if (!name && !flags.all) {
    console.error('usage: bun run propose <name>');
    console.error('       bun run propose --all');
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

  const wikiIndex: WikiIndex = JSON.parse(await Bun.file(wikiIndexPath).text());
  const presentFilenames = new Set(files.map((f) => f.filename));
  const model = opts.model ?? config().MODEL_PROPOSE;
  const ctx = {
    transcriptsDir, ledgerPath, resolutionsDir, matchesDir, segmentsDir,
    proposalsDir, contentDir, wikiIndexPath, claudeMdPath, model,
    completeFn: opts.completeFn, wikiIndex,
  };

  if (flags.all) {
    const targets = ledger.entries.filter(
      (e) =>
        presentFilenames.has(e.filename) &&
        e.stages.matched !== null &&
        e.stages.proposed === null,
    );
    if (targets.length === 0) {
      console.log('nothing to propose — all matched transcripts already have stages.proposed set');
      return;
    }
    const failures: string[] = [];
    for (const e of targets) {
      try {
        ledger = await proposeOne(e, ledger, ctx);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`! ${e.filename}: ${msg}`);
        ledger = recordError(ledger, e.filename, 'proposed', msg);
        await writeLedger(ctx.ledgerPath, ledger);
        failures.push(e.filename);
      }
    }
    console.log(`done: ${targets.length - failures.length}/${targets.length} proposed`);
    if (failures.length > 0) {
      throw new Error(`${failures.length} transcript(s) failed to propose`);
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
  if (r.entry.stages.matched === null) {
    console.error(`'${r.entry.filename}' has not been matched — run 'bun run match ${name}' first`);
    process.exit(1);
  }
  await proposeOne(r.entry, ledger, ctx);
}

export function register(program: Command): void {
  program
    .command('propose [name]')
    .description('Generate edit proposals for a transcript')
    .option('--all', 'process all unproposed transcripts')
    .action((n: string | undefined, opts: { all?: boolean }) => propose(n, opts));
}

export interface ProposeCtx {
  transcriptsDir:  string;
  ledgerPath:      string;
  resolutionsDir:  string;
  matchesDir:      string;
  segmentsDir:     string;
  proposalsDir:    string;
  contentDir:      string;
  wikiIndexPath:   string;
  claudeMdPath:    string;
  model:           string;
  completeFn?:     typeof defaultComplete;
  wikiIndex:       WikiIndex;
  writeLedgerFn?:  (path: string, ledger: Ledger) => Promise<void>;
}

interface MatchesFile {
  filename:          string;
  contentHash:       string;
  claimsContentHash: string;
  matches:           MatchEntry[];
}

interface ResolutionsFile {
  filename:          string;
  contentHash:       string;
  claimsContentHash: string;
  aliasSuggestions:  AliasSuggestion[];
  claims:            Claim[];
}

interface SegmentsFile {
  filename:   string;
  segments:   Segment[];
}

function clusterSlug(cluster: Cluster, idx: number): string {
  switch (cluster.kind) {
    case 'update':     return `${idx}.update.${slugify((cluster as UpdateCluster).targetPath)}`;
    case 'create':     return `${idx}.create.${slugify((cluster as CreateCluster).primaryEntity)}`;
    case 'alias-edit': return `${idx}.alias-edit.${slugify((cluster as AliasEditCluster).targetPath)}`;
    case 'comment':    return `${idx}.comment`;
  }
}

function slugify(s: string): string {
  return s.replace(/[/ .]/g, '_').slice(0, 40);
}

export async function proposeOne(
  entry: LedgerEntry,
  ledger: Ledger,
  ctx: ProposeCtx,
): Promise<Ledger> {
  // Guard: matches file must exist.
  const matchesFile = Bun.file(`${ctx.matchesDir}/${entry.filename}.json`);
  if (!(await matchesFile.exists())) {
    throw new Error(`matches file missing — run 'bun run match ${entry.filename}' first`);
  }
  const matchesData: MatchesFile = JSON.parse(await matchesFile.text());

  // Stale-input guard for matches.
  if (matchesData.contentHash !== entry.contentHash) {
    throw new Error(
      `transcript changed since match — reset stages and re-match before proposing`,
    );
  }

  // Guard: resolutions file must exist.
  const resolutionsFile = Bun.file(`${ctx.resolutionsDir}/${entry.filename}.json`);
  if (!(await resolutionsFile.exists())) {
    throw new Error(`resolutions file missing — run 'bun run resolve ${entry.filename}' first`);
  }
  const resolutionsData: ResolutionsFile = JSON.parse(await resolutionsFile.text());

  // Stale-input guard for resolutions.
  if (resolutionsData.contentHash !== entry.contentHash) {
    throw new Error(
      `transcript changed since resolution — reset stages and re-resolve before proposing`,
    );
  }

  // Guard: segments file must exist.
  const segmentsFile = Bun.file(`${ctx.segmentsDir}/${entry.filename}.json`);
  if (!(await segmentsFile.exists())) {
    throw new Error(`segments file missing — run 'bun run segment ${entry.filename}' first`);
  }
  const segmentsData: SegmentsFile = JSON.parse(await segmentsFile.text());

  // Build debug dir for this transcript.
  const debugDir = `${ctx.proposalsDir}/_debug/${entry.filename}`;
  await mkdir(debugDir, { recursive: true });

  let clusterIdx = 0;
  const result = await proposeTranscript(
    matchesData.matches,
    { claims: resolutionsData.claims, aliasSuggestions: resolutionsData.aliasSuggestions },
    segmentsData.segments,
    ctx.wikiIndex,
    {
      model:            ctx.model,
      contentDir:       ctx.contentDir,
      conventionsPath:  ctx.claudeMdPath,
      transcript:       entry.filename,
      completeFn:       ctx.completeFn,
      onClusterProposed: async (cluster, proposal) => {
        const idx = clusterIdx++;
        if (cluster.kind !== 'update' && cluster.kind !== 'create') return;
        const slug = clusterSlug(cluster, idx);
        const debugPath = `${debugDir}/${slug}.json`;
        const debugTmp  = `${debugPath}.tmp`;
        const debugPayload = { cluster, proposal, validated: proposal !== null };
        await Bun.write(debugTmp, JSON.stringify(debugPayload, null, 2) + '\n');
        await rename(debugTmp, debugPath);
      },
    },
  );

  await mkdir(ctx.proposalsDir, { recursive: true });
  const outPath = `${ctx.proposalsDir}/${entry.filename}.json`;
  const tmpPath = `${outPath}.tmp`;
  const payload = {
    filename:          entry.filename,
    contentHash:       entry.contentHash,
    matchesContentHash: matchesData.contentHash,
    stats:             result.stats,
    proposals:         result.proposals,
  };
  await Bun.write(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  await rename(tmpPath, outPath);

  const next = markStage(ledger, entry.filename, 'proposed');
  await (ctx.writeLedgerFn ?? writeLedger)(ctx.ledgerPath, next);

  const s = result.stats;
  const dropped = Object.entries(s.droppedByReason)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const droppedStr = dropped ? ` (${Object.values(s.droppedByReason).reduce((a, b) => a + b, 0)} dropped: ${dropped})` : '';
  console.log(
    `proposed ${entry.filename}: ${result.proposals.length} proposals — ` +
    `${s.proposalsByKind.edit} edit, ${s.proposalsByKind.append} append, ` +
    `${s.proposalsByKind.create} create, ${s.proposalsByKind.comment} comment ` +
    `from ${s.totalClusters} clusters${droppedStr}, ${s.llmCalls} LLM calls`,
  );
  return next;
}
