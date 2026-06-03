# Claim-to-Page Matching Implementation Plan

## Overview

For each extracted claim, find 0–3 candidate wiki pages it touches and classify each `(claim, page)` pair as `new`, `consistent`, `update`, or `contradict`. Persist results to `state/matches/<filename>.json` and mark `stages.matched` in the ledger.

Claims feed directly from ticket 007 (`state/claims/<filename>.json`) and the results feed ticket 009 (edit-proposal-generation).

## Current State Analysis

Ticket 007 is complete. One transcript has a claims file (`state/claims/000.through-a-song-darkly.2025-8-28.txt.json` — 247 claims, 55 units). The wiki index (`state/wiki-index.json`) has 93 pages, every one with a `summary`, `keyFacts`, `entities`, `title`, and `aliases` computed by ticket 004. Total index file is 173 KB.

Useful primitives already in place:

- **LLM wrapper** (`src/llm.ts:33`): `complete()` with cached system block, schema-validated tool-use, `temperature: 0`, automatic cost logging.
- **`MODEL_MATCH`** (`src/config.ts:6`): defaults to `claude-sonnet-4-6`.
- **Wiki index schema** (`src/wiki/index-schema.ts`): `PageRecord` has `path`, `title`, `aliases`, `entities`, `summary`, `byteLength`. `WikiIndex.pages` is `Record<string, PageRecord>`.
- **Claim type** (`src/transcript/extract.ts:116`): `{ claim, lines, speaker, role, confidence, entities, sourceSegmentStartLine }`.
- **CLI pattern** (`src/cli/extract.ts`): reconcile → find/dispatch → read claims → process → atomic write → markStage → summary. Will be mirrored verbatim.
- **Ledger** (`src/transcript/ledger.ts`): `matched` is already in `STAGE_ORDER` (index 2). `markStage`, `recordError`, `findEntry`, `readLedger`, `writeLedger`, `reconcile` all ready.

What's missing: `src/reconcile/` directory, candidate retrieval, classifier, orchestrator, and CLI command.

## Desired End State

After this ticket:

- `bun run match 000.through-a-song-darkly.2025-8-28` reads the claims file, runs candidate retrieval + classification, writes `state/matches/000.through-a-song-darkly.2025-8-28.txt.json`, and marks `stages.matched`.
- `bun run match --all` processes every transcript where `stages.extracted` is set and `stages.matched` is null.
- Every claim has exactly one or more entries in `candidatePages`. Claims with no fast-match and no LLM match get a synthetic `{ path: null, relation: 'new', rationale: '...', excerpt: null }` entry.
- No candidate list exceeds 3 pages per claim.
- `content/Rules/*` pages are excluded from the candidate pool.
- Pages are loaded at most once per transcript run (deduped by path).
- Running twice on the same transcript produces byte-identical output (`temperature: 0`, deterministic post-processing).

### Key Discoveries

- The wiki index already has all data needed for fast matching and for the LLM-fallback prompt — no disk reads required for candidate retrieval. (`state/wiki-index.json`)
- Page count is 93; excluding `Rules/*` leaves ~88 pages. All summaries total ~8 KB — easily fits in a single cached prompt block. (`state/wiki-index.json:1`)
- Largest wiki page is `Timeline.md` at ~16 KB; most are <3 KB; median is 665 bytes. Loading all candidates for a transcript is unlikely to hit the 500 KB cap in practice. (`content/Timeline.md`)
- The ledger already has `matched` at stage index 2 (`src/transcript/ledger.ts:5`). No schema changes needed.
- The claims file carries `contentHash` of the transcript at extraction time — used to detect stale claims before matching, parallel to how the extract stage guards against stale segments. (`state/claims/000.through-a-song-darkly.2025-8-28.txt.json:3`)
- `claim.entities` is the array of proper nouns extracted per claim and is the input to fast-matching. It may be empty for some claims (handled by sending them to the LLM fallback). (`src/transcript/extract.ts:113`)

## What We're NOT Doing

- No cross-transcript deduplication of claims or matches — each transcript is processed independently.
- No scoring/ranking beyond "trust LLM output order, take first 3" — no entity-overlap scoring.
- No editing of wiki pages — that's ticket 009.
- No `--force` flag. Re-matching requires `bun run transcripts reset <name> --stage matched`.
- No parallel LLM calls — sequential, same as all prior stages.
- No retry on LLM validation failure — bad entries logged and dropped; run continues.
- No filtering to main-campaign transcripts only.

## Implementation Approach

Four phases that build cleanly on each other. Phases 1–3 have no live LLM calls and are fully testable with injected fakes. Phase 4 is the first phase that burns tokens.

1. **Candidate retrieval** — pure fast-match + batched LLM fallback. No IO beyond the pre-loaded index.
2. **Classifier** — batch-by-page LLM calls; loads page text from disk.
3. **Orchestrator** — wires phases 1+2, assembles per-claim output, computes stats.
4. **CLI + persistence** — atomic write, ledger mutations, debug output.

---

## Phase 1: Candidate Retrieval

### Overview

`src/reconcile/candidates.ts`. Given the wiki index and a list of claims, return for each claim an ordered list of 0–3 candidate page paths. Two stages:

(a) **Fast**: build a lowercase lookup map from `page.title` and each `page.alias` → `page.path`, excluding `Rules/*`. For each claim, look up each `claim.entities[i].toLowerCase()` and collect matching paths. Dedupe, cap at 3.

(b) **LLM fallback**: claims that still have 0 candidates after the fast stage are batched (~20 per call) and sent to `MODEL_MATCH` with the full cached index summary. The LLM returns 0–3 page paths per claim. Paths are validated against the index and merged into the result. Dedupe, cap at 3. Claims still at 0 after fallback are returned as empty (`standaloneNew`).

### Changes Required

#### 1. New file: `src/reconcile/candidates.ts`

```ts
import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';

export interface CandidateResult {
  claimIndex: number;
  paths: string[];        // deduped, ordered by relevance, max 3, Rules/* excluded
  fastMatched: boolean;   // true if any path came from the fast lookup
}

export interface FindCandidatesOptions {
  model: string;
  transcript?: string;
  batchSize?: number;          // claims per LLM fallback call, default 20
  completeFn?: typeof defaultComplete;
}

// Build the cached index-summary block for the LLM fallback.
// Format: one line per page: "path — title (aliases) — summary"
export function buildIndexSummary(index: WikiIndex): string {
  const lines: string[] = [
    'Available wiki pages (do not return paths not in this list):',
    '',
  ];
  for (const [path, page] of Object.entries(index.pages)) {
    if (path.startsWith('Rules/')) continue;
    const aliasStr = page.aliases.length ? ` (${page.aliases.join(', ')})` : '';
    lines.push(`${path} — ${page.title}${aliasStr} — ${page.summary ?? '(no summary)'}`);
  }
  return lines.join('\n');
}

const CANDIDATE_SYSTEM_PROMPT = [
  'You are a wiki page matching assistant for a Pathfinder 2e campaign.',
  'Given a numbered list of claims from session transcripts, identify which wiki pages each claim relates to.',
  'For each claim, return 0–3 page paths from the list below, ordered from most to least relevant.',
  'If no page is relevant, return an empty paths array for that claim.',
  'IMPORTANT: Only return paths exactly as shown in the list. Do not invent paths.',
  '',
  '{{INDEX_SUMMARY}}',
].join('\n');

const FallbackOutputSchema = z.object({
  matches: z.array(z.object({
    claimIndex: z.number().int().nonnegative(),
    paths: z.array(z.string()).max(3),
  })),
});

export async function findCandidates(
  claims: Claim[],
  index: WikiIndex,
  opts: FindCandidatesOptions,
): Promise<CandidateResult[]> {
  const batchSize = opts.batchSize ?? 20;
  const fn = opts.completeFn ?? defaultComplete;

  // Build fast-match lookup (title + aliases, lowercase, Rules/* excluded).
  const fastMap = new Map<string, string>();
  for (const [path, page] of Object.entries(index.pages)) {
    if (path.startsWith('Rules/')) continue;
    const add = (key: string) => { if (!fastMap.has(key)) fastMap.set(key, path); };
    add(page.title.toLowerCase());
    for (const alias of page.aliases) add(alias.toLowerCase());
  }

  const results: CandidateResult[] = claims.map((_, i) => ({
    claimIndex: i,
    paths: [],
    fastMatched: false,
  }));

  const fallbackIndices: number[] = [];

  for (let i = 0; i < claims.length; i++) {
    const entities = claims[i]!.entities;
    const paths = new Set<string>();
    for (const entity of entities) {
      const hit = fastMap.get(entity.toLowerCase());
      if (hit) paths.add(hit);
      if (paths.size >= 3) break;
    }
    if (paths.size > 0) {
      results[i]!.paths = [...paths].slice(0, 3);
      results[i]!.fastMatched = true;
    } else {
      fallbackIndices.push(i);
    }
  }

  if (fallbackIndices.length === 0) return results;

  // LLM fallback: batch unmatched claims.
  const indexSummary = buildIndexSummary(index);
  const cachedPrompt = CANDIDATE_SYSTEM_PROMPT.replace('{{INDEX_SUMMARY}}', indexSummary);
  const validPaths = new Set(
    Object.keys(index.pages).filter((p) => !p.startsWith('Rules/')),
  );

  for (let b = 0; b < fallbackIndices.length; b += batchSize) {
    const batch = fallbackIndices.slice(b, b + batchSize);
    const userLines = batch.map((i) => `[${i}] ${claims[i]!.claim}`);
    const result = await fn({
      stage: 'match-candidates',
      transcript: opts.transcript,
      model: opts.model,
      cached: cachedPrompt,
      user: userLines.join('\n'),
      schema: FallbackOutputSchema,
      maxTokens: 2048,
    });
    for (const m of result.value.matches) {
      if (m.claimIndex < 0 || m.claimIndex >= claims.length) continue;
      const validatedPaths = m.paths
        .filter((p) => validPaths.has(p))
        .slice(0, 3);
      if (validatedPaths.length > 0) {
        results[m.claimIndex]!.paths = validatedPaths;
      }
    }
  }

  return results;
}
```

#### 2. Tests: `src/reconcile/candidates.test.ts`

- **Fast match**: claim with entity "Iridescent Host" → matches `Divinity/Outer Gods/Iridescent Host.md`. Fast-matched.
- **Alias match**: entity "Host" (an alias) → same page.
- **Case-insensitive**: entity "iridescent host" → same page.
- **Rules exclusion**: a page path starting with `Rules/` is never returned even if entity matches its title.
- **Cap at 3**: claim with 5 matching entities returns at most 3 paths.
- **LLM fallback triggered**: claim with no entities goes to fallback; fake completeFn receives the claim in the batch user message.
- **LLM fallback invalid path dropped**: fake LLM returns a path not in the index — it's silently dropped.
- **Batch boundary**: 45 unmatched claims → 3 batches of 20/20/5; fake completeFn is called 3 times.
- **All-matched**: zero fallback calls if all claims fast-match.
- **Empty entities**: claim with `entities: []` goes to fallback (no fast hits possible).
- **Standalone new**: claim with no fast match and fallback returns empty paths → `paths: []`.
- **`buildIndexSummary`**: output does not include `Rules/*` entries; each line contains path, title, and summary.

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/candidates.test.ts` passes
- [x] `bun run typecheck` passes

---

## Phase 2: Classifier

### Overview

`src/reconcile/classify.ts`. Given candidate results and the wiki index, classify each `(claim, pagePath)` pair. Groups all claims that share a candidate page and sends them together in one MODEL_MATCH call with the full page text cached. Claims with `paths: []` get a synthetic `new` entry — no LLM call.

### Changes Required

#### 1. New file: `src/reconcile/classify.ts`

```ts
import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import type { CandidateResult } from './candidates';

export interface CandidatePageResult {
  path: string | null;
  relation: 'new' | 'consistent' | 'update' | 'contradict';
  rationale: string;
  excerpt: string | null;
}

export interface ClassifyResult {
  claimIndex: number;
  candidatePages: CandidatePageResult[];
}

export interface ClassifyOptions {
  model: string;
  contentDir: string;
  transcript?: string;
  byteCap?: number;           // log warning if cumulative bytes loaded exceeds this; default 500_000
  completeFn?: typeof defaultComplete;
  onPageClassified?: (pagePath: string, claimsClassified: number) => void;
}

const CLASSIFIER_SYSTEM = [
  'You are classifying claims from a Pathfinder 2e campaign transcript against a wiki page.',
  'For each claim (identified by its index), determine how the claim relates to the page:',
  '  consistent  — the claim is already covered by the page; no edit needed',
  '  update      — the claim adds information not yet in the page',
  '  contradict  — the claim conflicts with something the page states',
  '  new         — the claim is about a different entity or topic; it does not belong on this page',
  'For each claim, provide:',
  '  - relation: one of the four values above',
  '  - rationale: one sentence explaining the classification',
  '  - excerpt: a verbatim quote from the page relevant to the claim (null if none applies)',
  'IMPORTANT: Base your classification only on the page text provided. Do not invent facts.',
].join('\n');

const ClassifierOutputSchema = z.object({
  results: z.array(z.object({
    claimIndex: z.number().int().nonnegative(),
    relation: z.enum(['new', 'consistent', 'update', 'contradict']),
    rationale: z.string().min(1),
    excerpt: z.string().nullable(),
  })),
});

export async function classifyCandidates(
  claims: Claim[],
  candidates: CandidateResult[],
  index: WikiIndex,
  opts: ClassifyOptions,
): Promise<ClassifyResult[]> {
  const fn = opts.completeFn ?? defaultComplete;
  const byteCap = opts.byteCap ?? 500_000;

  // Build per-claim result map (claimIndex → candidatePages, ordered by candidate paths order).
  const resultMap = new Map<number, CandidatePageResult[]>();
  for (let i = 0; i < claims.length; i++) {
    resultMap.set(i, []);
  }

  // Invert: pagePath → claimIndices (in the order they appear in candidate paths).
  // Preserve original candidate order per claim.
  const pageToClaimIndices = new Map<string, number[]>();
  for (const cand of candidates) {
    for (const path of cand.paths) {
      if (!pageToClaimIndices.has(path)) pageToClaimIndices.set(path, []);
      pageToClaimIndices.get(path)!.push(cand.claimIndex);
    }
  }

  // Standalone-new claims (paths === []).
  for (const cand of candidates) {
    if (cand.paths.length === 0) {
      resultMap.get(cand.claimIndex)!.push({
        path: null,
        relation: 'new',
        rationale: 'No candidate wiki page matched this claim.',
        excerpt: null,
      });
    }
  }

  // Classify per page.
  let bytesLoaded = 0;
  for (const [pagePath, claimIndices] of pageToClaimIndices) {
    const pageFile = Bun.file(`${opts.contentDir}/${pagePath}`);
    const pageText = await pageFile.text();
    bytesLoaded += pageText.length;
    if (bytesLoaded > byteCap) {
      console.warn(
        `match(${opts.transcript}): page-load total ${bytesLoaded} bytes exceeds ${byteCap}-byte cap after loading ${pagePath}`,
      );
    }

    const userLines = claimIndices.map((i) => `[${i}] ${claims[i]!.claim}`);
    const cachedBlock = `${CLASSIFIER_SYSTEM}\n\n--- Wiki Page: ${pagePath} ---\n${pageText}`;

    const result = await fn({
      stage: 'match-classify',
      transcript: opts.transcript,
      model: opts.model,
      cached: cachedBlock,
      user: [
        `Classify each of the following claims against the wiki page shown above:`,
        ...userLines,
      ].join('\n'),
      schema: ClassifierOutputSchema,
      maxTokens: 4096,
    });

    for (const r of result.value.results) {
      if (!claimIndices.includes(r.claimIndex)) continue;  // LLM hallucinated an index
      resultMap.get(r.claimIndex)!.push({
        path: pagePath,
        relation: r.relation,
        rationale: r.rationale,
        excerpt: r.excerpt,
      });
    }

    opts.onPageClassified?.(pagePath, claimIndices.length);
  }

  // Assemble output, preserving candidate path order per claim.
  // Results from the page-loop may arrive out of candidate order; re-sort by the original path order.
  const output: ClassifyResult[] = [];
  for (const cand of candidates) {
    const pages = resultMap.get(cand.claimIndex)!;
    // Re-sort by original path order (standalone-new has no path and sorts first by convention).
    const ordered = cand.paths.map((path) => pages.find((p) => p.path === path)).filter(Boolean) as CandidatePageResult[];
    const standaloneNew = pages.filter((p) => p.path === null);
    output.push({
      claimIndex: cand.claimIndex,
      candidatePages: [...standaloneNew, ...ordered],
    });
  }

  return output;
}
```

#### 2. Tests: `src/reconcile/classify.test.ts`

- **Standalone-new**: claim with `paths: []` gets a synthetic `{ path: null, relation: 'new', ... }` entry; no LLM call for it.
- **Single-page batch**: 3 claims all target the same page → one fake completeFn call with all 3 in the user message; page is loaded once.
- **Multi-page**: claims targeting 2 different pages → 2 calls, each with the correct subset of claims.
- **LLM hallucinated index**: fake LLM returns a claimIndex not in the batch → silently dropped.
- **Byte cap warning**: stub a large page that pushes bytesLoaded over 500KB; `console.warn` is called.
- **Order preservation**: candidate paths are `[A, B]` for a claim; result `candidatePages` has A before B even if LLM returns them in reverse order.
- **Excerpt null**: fake LLM returns `excerpt: null`; propagated correctly.
- **No rules pages**: if somehow a Rules/* path appeared in candidates (shouldn't happen but guard), classifier would load it — test by confirming candidates module never passes them through.

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/classify.test.ts` passes
- [x] `bun run typecheck` passes

---

## Phase 3: Orchestrator

### Overview

`src/reconcile/match.ts`. Top-level `matchTranscript()` that wires candidate retrieval + classification and returns the assembled per-claim output plus run statistics. Tested with injected fakes — no live API or disk reads.

### Changes Required

#### 1. New file: `src/reconcile/match.ts`

```ts
import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import { findCandidates } from './candidates';
import { classifyCandidates } from './classify';
import type { CandidatePageResult } from './classify';

export interface MatchEntry {
  claim: Claim;
  candidatePages: CandidatePageResult[];
}

export interface MatchStats {
  totalClaims: number;
  standaloneNew: number;
  pagesLoaded: number;
  bytesLoaded: number;
  candidateBatches: number;   // LLM fallback calls for candidate retrieval
  classifierBatches: number;  // LLM calls for classification (one per unique page)
}

export interface MatchTranscriptResult {
  matches: MatchEntry[];
  stats: MatchStats;
}

export interface MatchTranscriptOptions {
  model: string;
  contentDir: string;
  transcript?: string;
  batchSize?: number;
  byteCap?: number;
  completeFn?: typeof defaultComplete;
}

export async function matchTranscript(
  claims: Claim[],
  index: WikiIndex,
  opts: MatchTranscriptOptions,
): Promise<MatchTranscriptResult> {
  let candidateBatches = 0;
  let classifierBatches = 0;
  let bytesLoaded = 0;

  const wrappedCompleteFn: typeof defaultComplete | undefined = opts.completeFn
    ? (async (args) => {
        if (args.stage === 'match-candidates') candidateBatches++;
        if (args.stage === 'match-classify') classifierBatches++;
        return opts.completeFn!(args);
      }) as typeof defaultComplete
    : undefined;

  const candidates = await findCandidates(claims, index, {
    model: opts.model,
    transcript: opts.transcript,
    batchSize: opts.batchSize,
    completeFn: wrappedCompleteFn,
  });

  const uniquePages = new Set(candidates.flatMap((c) => c.paths));

  const classified = await classifyCandidates(claims, candidates, index, {
    model: opts.model,
    contentDir: opts.contentDir,
    transcript: opts.transcript,
    byteCap: opts.byteCap,
    completeFn: wrappedCompleteFn,
    onPageClassified: (_, __) => { classifierBatches; }, // counted via wrappedCompleteFn
  });

  // Track bytes loaded from classifier (re-read from file metadata in index).
  for (const path of uniquePages) {
    bytesLoaded += index.pages[path]?.byteLength ?? 0;
  }

  const standaloneNew = classified.filter((r) =>
    r.candidatePages.length === 1 && r.candidatePages[0]!.path === null,
  ).length;

  const matches: MatchEntry[] = classified.map((r) => ({
    claim: claims[r.claimIndex]!,
    candidatePages: r.candidatePages,
  }));

  return {
    matches,
    stats: {
      totalClaims: claims.length,
      standaloneNew,
      pagesLoaded: uniquePages.size,
      bytesLoaded,
      candidateBatches,
      classifierBatches,
    },
  };
}
```

#### 2. Tests: `src/reconcile/match.test.ts`

- **Happy path**: 5 claims; 3 fast-match, 2 go to LLM fallback; each classified; `matches` has 5 entries in claim order.
- **Stats**: `standaloneNew`, `pagesLoaded`, `bytesLoaded`, `candidateBatches`, `classifierBatches` all reflect correct counts.
- **All standalone-new**: all claims have no entity match and LLM returns empty; all entries have `{ path: null, relation: 'new', ... }`.
- **Claim order preserved**: output `matches[i].claim` equals input `claims[i]`.

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/match.test.ts` passes
- [x] `bun run typecheck` passes
- [x] All existing tests pass: `bun test`

---

## Phase 4: CLI Command and Persistence

### Overview

Wire phases 1–3 into `bun run match`. Mirrors `src/cli/extract.ts` exactly: reconcile → find/dispatch → read claims file → stale-guard → `matchTranscript` → atomic write → ledger → summary. This is the first phase that burns API tokens.

### Changes Required

#### 1. New CLI handler: `src/cli/match.ts`

```ts
import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { matchTranscript } from '../reconcile/match';
import type { Claim } from '../transcript/extract';
import { config } from '../config';
import type { complete as defaultComplete } from '../llm';

const TRANSCRIPTS_DIR = 'transcripts';
const LEDGER_PATH     = 'state/processed.json';
const CLAIMS_DIR      = 'state/claims';
const MATCHES_DIR     = 'state/matches';
const CONTENT_DIR     = 'content';
const WIKI_INDEX_PATH = 'state/wiki-index.json';

export interface MatchCliOptions {
  transcriptsDir?: string;
  ledgerPath?:     string;
  claimsDir?:      string;
  matchesDir?:     string;
  contentDir?:     string;
  wikiIndexPath?:  string;
  model?:          string;
  completeFn?:     typeof defaultComplete;
}
```

**Behavior mirrors `src/cli/extract.ts`**:

- Reconciles ledger against discovery on every invocation.
- `bun run match <name>`: resolve via `findEntry`; error if `stages.extracted` is null; read and stale-check the claims file (see below); run `matchTranscript`; write output; `markStage('matched')`; persist. On failure, `recordError` + persist + exit non-zero.
- `bun run match --all`: iterate entries where `stages.extracted` is non-null AND `stages.matched` is null AND file is on disk. Sequential. Persist ledger after each success or failure. Print summary; exit non-zero if any failed.
- No `--force`.

**Stale-claims guard**:

```ts
const claimsFile = Bun.file(`${ctx.claimsDir}/${entry.filename}.json`);
if (!(await claimsFile.exists())) {
  throw new Error(`claims file missing — run 'bun run extract ${entry.filename}' first`);
}
const claimsData = JSON.parse(await claimsFile.text());
if (claimsData.contentHash !== entry.contentHash) {
  throw new Error(
    `transcript changed since extraction — run 'bun run transcripts reset ${entry.filename} --stage extracted' then re-extract before matching`,
  );
}
const claims: Claim[] = claimsData.claims;
```

**Output JSON shape** (`state/matches/<filename>.json`):

```json
{
  "filename": "000.through-a-song-darkly.2025-8-28.txt",
  "contentHash": "76456b04...",
  "claimsContentHash": "76456b04...",
  "stats": {
    "totalClaims": 247,
    "standaloneNew": 12,
    "pagesLoaded": 18,
    "bytesLoaded": 45200,
    "candidateBatches": 8,
    "classifierBatches": 18
  },
  "matches": [
    {
      "claim": {
        "claim": "Illmari Vaino told the party they could come stay and have rooms.",
        "lines": [456, 458],
        "speaker": "Gamemaster",
        "role": "gm",
        "confidence": "stated",
        "entities": ["Illmari Vaino"],
        "sourceSegmentStartLine": 448
      },
      "candidatePages": [
        {
          "path": "Org/Iconoclasm/People/Illmari Vaino.md",
          "relation": "consistent",
          "rationale": "The page already notes Illmari as the party's host providing room and board.",
          "excerpt": "Illmari Vaino acts as the party's gracious host..."
        }
      ]
    },
    {
      "claim": { "claim": "...", "..." },
      "candidatePages": [
        { "path": null, "relation": "new", "rationale": "No candidate wiki page matched this claim.", "excerpt": null }
      ]
    }
  ]
}
```

Written via atomic tmp-rename, matching `writeLedger`'s pattern.

**Debug output** (`state/matches/_debug/<filename>/<page-slug>.json`, gitignored):

One file per page classified, written via an `onPageClassified` extension (requires adding a `onPageClassified` callback to classifier that also receives the raw LLM output). Page slug: replace `/` and spaces with `_`, strip `.md`.

```json
{
  "pagePath": "Org/Iconoclasm/index.md",
  "claimIndices": [3, 7, 14],
  "rawResults": [ /* exactly what the LLM returned */ ],
  "classifiedResults": [ /* after validation/filtering */ ]
}
```

**CLI summary line**:

```
matched 000.through-a-song-darkly.2025-8-28.txt: 247 claims — 12 standalone-new, 18 pages loaded (45200 bytes), 8 candidate batches, 18 classifier calls
```

#### 2. Register in CLI map: `src/cli/index.ts`

```ts
import { match } from './match';
// ...
export const handlers: Record<string, CliHandler> = {
  // existing entries unchanged
  'match': match,
};
```

#### 3. Add script: `package.json`

```json
"match": "bun index.ts match"
```

#### 4. Gitignore debug directory

Add `state/matches/_debug/` to `.gitignore`. The `state/matches/` root itself is **not** gitignored — committed match outputs follow the same convention as `state/claims/`.

#### 5. CLI tests: `src/cli/match.test.ts`

Use an injected fake `completeFn` and tmp directories. Cover:

- Single-transcript run writes `state/matches/<name>.json`, sets `stages.matched`, ledger persists.
- `--all` skips transcripts whose `stages.matched` is already set.
- `--all` skips transcripts whose `stages.extracted` is null.
- `--all` continues past a single-transcript failure, records the error, exits non-zero at end.
- Stale claims detection: claims file `contentHash` doesn't match ledger → throws with helpful message; ledger records the error.
- Missing claims file → throws with helpful message.
- Output JSON parses correctly and has `matches` array with one entry per claim.
- Running twice on the same transcript with deterministic fake LLM produces byte-identical output.
- Debug files are written to `_debug/<filename>/<page-slug>.json` for each page classified.

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/match.test.ts` passes
- [x] All tests pass: `bun test`
- [x] Type check passes: `bun run typecheck`
- [ ] `bun run match` with no args prints usage and exits non-zero
- [x] Running `bun run match <name>` twice on the same transcript produces byte-identical `state/matches/<name>.json`

#### Manual Verification
- [ ] `bun run match 000.through-a-song-darkly.2025-8-28` runs without error; spot-check 10 `consistent` matches against their page — each should be clearly supported
- [ ] Find at least one `update` match and verify the claim genuinely adds information not in the page
- [ ] Find at least one `contradict` match (inject one if needed) and verify it correctly identifies a conflict
- [ ] A known-stub page (e.g. a character with no body text) returns `new` or `update` appropriately
- [ ] `bun run cost-report` shows the `match-candidates` and `match-classify` stages; total cost is reasonable (expect $0.50–$2.00 per transcript)
- [ ] `bun run transcripts list` shows `mat` column set for processed transcripts
- [ ] `bun run match --all` runs to completion for all extracted transcripts

**Implementation Note**: Run on one transcript and hand-check before running `--all`.

---

## Testing Strategy

### Unit Tests

- **Phase 1 — candidates**: fast-match (title, alias, case-insensitive), Rules/* exclusion, cap at 3, LLM fallback triggering, batch boundary, invalid-path dropped, standalone-new.
- **Phase 2 — classifier**: standalone-new synthetic entry, single-page batching, multi-page batching, hallucinated index dropped, byte-cap warning, output order preservation.
- **Phase 3 — orchestrator**: end-to-end assembly, stat counts, claim-order invariant.
- **Phase 4 — CLI**: all CLI-level cases.

### Integration Tests

The CLI tests in phase 4 exercise candidates → classifier → orchestrator → atomic write → ledger end-to-end with an injected fake `complete()`.

### Manual Testing Steps

1. `bun run match 000.through-a-song-darkly.2025-8-28` — run; scan `state/matches/000.through-a-song-darkly.2025-8-28.txt.json`.
2. Pick 5 `consistent` entries; open the cited page and verify the claim is covered.
3. Pick 5 `update` entries; open the cited page and verify the claim adds genuinely new information.
4. Check `standaloneNew` count in stats. Spot-check a few — entities should be clearly absent from the wiki.
5. `bun run cost-report` — confirm both `match-candidates` and `match-classify` stages appear; cost per transcript is within expected range.
6. `bun run match --all` (after eyeball check passes).
7. `bun run transcripts list` — confirm all extracted transcripts show `✓` under `mat`.

---

## Performance Considerations

- **Candidate retrieval cost**: Fast-match is free. LLM fallback: suppose 100/247 claims lack entities; batched in 5 calls × (~8 KB cached index + ~0.5 KB user) ≈ $0.05 total.
- **Classifier cost per transcript**: ~20 unique pages × (page text ~2 KB cached + ~1 KB user) at Sonnet pricing → ~20 × $0.02 = $0.40. Heavy cache-write on first run; cache-reads on retry.
- **Total per transcript**: ~$0.50–$1.50. Across 37 transcripts: ~$20–$55. Run `bun run cost-report` after the first transcript to calibrate.
- **500 KB page-load cap**: with 20 pages of average 2.4 KB each = 48 KB. Timeline.md at 16 KB is the largest outlier. In practice we're orders of magnitude under the cap.
- **Wall-clock**: ~20 classifier calls + ~5 candidate calls = 25 calls per transcript at ~3s each ≈ 75s. Across 37 transcripts: ~46 minutes. Sequential is correct.

## Migration Notes

None. This adds a new stage between `extracted` and `proposed`. Existing claims files are the input; ledger entries gain a populated `matched` timestamp. No existing data needs reformatting.

## References

- Original ticket: `tickets/008-claim-to-page-matching.md`
- Parent epic: `tickets/001-create-project.md`
- Next ticket: `tickets/009-edit-proposal-generation.md`
- Previous plan: `thoughts/shared/plans/2026-05-17-007-claim-extraction.md`
- LLM wrapper: `src/llm.ts:33`
- Wiki index schema: `src/wiki/index-schema.ts:1`
- Extract CLI (pattern to mirror): `src/cli/extract.ts:1`
- Cached-prompt precedent: `src/wiki/summarize.ts:51`, `src/transcript/extract.ts:122`
- Ledger mutators: `src/transcript/ledger.ts:157` (`markStage`), `src/transcript/ledger.ts:165` (`recordError`)
- Claims output sample: `state/claims/000.through-a-song-darkly.2025-8-28.txt.json`
- Wiki index: `state/wiki-index.json`
