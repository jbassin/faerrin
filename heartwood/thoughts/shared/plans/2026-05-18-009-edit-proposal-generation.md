# Edit Proposal Generation Implementation Plan

## Overview

Convert per-transcript match output (from ticket 008) into concrete markdown proposals — a mix of literal-substring edits, append-after-heading additions, new-page creations, deterministic alias-frontmatter edits, and MR-only comments. Proposals are persisted to `state/proposals/<filename>.json` and gated by validators before they leave the proposer. A future ticket (010) re-verifies each proposal against transcript citations.

This is the first stage that produces output destined to land in `content/`. Conservatism here is load-bearing: any hallucination that escapes the proposer must still be caught by the verifier, but the proposer should not be the source of the hallucination.

## Current State Analysis

Ticket 008 (`thoughts/shared/plans/2026-05-17-008-claim-to-page-matching.md`) is complete; ticket 015 (`thoughts/shared/plans/2026-05-18-015-naming-resolution.md`) added the `resolve` stage between `extract` and `match`. The pipeline now is:

```
segment → extract → resolve → match → [propose] → verify → prOpen
```

Inputs available to this stage:

- `state/matches/<filename>.json` (schema in `src/reconcile/match.ts:8-25`) — each entry is `{ claim: Claim, candidatePages: [{ path, relation, rationale, excerpt }] }`. Relations: `consistent | update | contradict | new`. Standalone-new claims have a single candidate with `path: null`.
- `state/resolutions/<filename>.json` (schema in `src/reconcile/resolve.ts:7` + ticket 015 plan) — gives canonicalized `claim.entities` and an `aliasSuggestions` array `{ variant, canonical, page, method, occurrences }`. Each claim also has `entityResolutions: [{ original, canonical, page, method, suggestAlias }]`.
- `state/segments/<filename>.json` (schema in `src/transcript/segment.ts:18-24`) — line-range labels (`ic | recap | mixed | ic | ooc | rules | combat`).
- `state/wiki-index.json` — `path`, `title`, `aliases`, `byteLength`, `headings` for every page.
- `content/<path>` — the page text itself. Frontmatter parser in `src/wiki/frontmatter.ts`, wikilink extractor in `src/wiki/wikilinks.ts`.
- `CLAUDE.md` lines 2–186 — the "## Content Files" section documenting Obsidian conventions, frontmatter formats, callouts, and per-content-type templates.

Useful primitives already in place:

- **LLM wrapper** (`src/llm.ts:33`): `complete()` with cached system block, schema-validated tool-use, `temperature: 0`, automatic cost logging.
- **`MODEL_PROPOSE`** (`src/config.ts:9`): defaults to `claude-sonnet-4-6`.
- **Ledger** (`src/transcript/ledger.ts:5-13`): `proposed` is already at stage index 4. `markStage`, `recordError`, `findEntry`, `readLedger`, `writeLedger`, `reconcile` all ready.
- **Frontmatter parsing** (`src/wiki/frontmatter.ts:10`) — round-trips YAML cleanly; we'll use it for alias-edit construction and frontmatter validation.
- **CLI pattern** (`src/cli/match.ts:32`) — reconcile → find/dispatch → load resolutions + matches → stale-guard → orchestrate → atomic write → `markStage` → summary. We mirror this verbatim.

What's missing: `src/reconcile/{cluster,propose,validate}.ts`, `src/cli/propose.ts`, the proposals output directory, and `package.json` script.

### Key Discoveries

- **`mixed` segments are also extraction-eligible** (`src/transcript/extract.ts:10`) — the ticket's success criterion "all citation ranges fall inside `ic`/`recap` segments" is too narrow. The correct invariant is: citation ranges fall inside segments whose label is one of `EXTRACT_LABELS = ['ic', 'recap', 'mixed']`. The plan codifies this and the validator enforces it.
- **Standalone-new clusters need a primary entity.** The current `Claim` schema does not denote a "primary" entity — claims can mention 2+. The cluster builder picks the first entity in `claim.entities` that has a corresponding `entityResolutions[i].page === null`. Ties are broken by occurrence count across the transcript (highest first), then alphabetically.
- **Multi-page updates** are kept (per user decision): a claim with two `update` candidate pages produces two edits. Each cluster groups by `target page`, so the same claim simply appears in two clusters with the same citation.
- **Alias-add edits are deterministic** — no LLM call needed. They directly transform the existing frontmatter `aliases` list. The validator still runs (the constructed `oldText` must be a literal substring of the page).
- **Pages without `aliases:` in frontmatter** are common (e.g. `content/Org/Iconoclasm/index.md` has aliases, but `content/Phenomena/Harmony/index.md` doesn't). The deterministic alias-edit builder must handle both cases: append a new `aliases:` block when one doesn't exist, or extend an existing one.
- **Realistic distribution** from `state/matches/000.through-a-song-darkly.2025-8-28.txt.json`: 96 claims → 35 `update`, 69 `new` (most of which are noise per ticket 010's verifier responsibility), 8 `consistent`, 3 `contradict`. Sample LLM costs at this distribution: ~20 unique pages with updates, ~30 new-page proposals → ~50 Sonnet 4.6 calls per transcript.
- **The `consistent` relation is fully skipped** in proposal generation. No proposal emitted; the verifier doesn't see it.
- **The classifier-emitted `new` relation with `path != null`** ("this claim doesn't belong on this page") is fully skipped — it's already-classified noise; only the path-less `new` (standalone) triggers create proposals.
- **CLAUDE.md "## Content Files" section ends at line 186** (before the standalone "Default to using Bun" line). The proposer reads lines 1–186 (or the section between `## Content Files` and the next `^---$` separator) and caches it as the system context.

## Desired End State

After this plan:

- `bun run propose <name>` reads matches+resolutions, produces proposals, writes `state/proposals/<filename>.json`, and marks `stages.proposed`.
- `bun run propose --all` processes every transcript where `stages.matched !== null` and `stages.proposed === null`.
- Every persisted proposal is one of `{ kind: 'edit' | 'create' | 'append' | 'comment' }`.
- For `edit`: `oldText` appears exactly once in the target file.
- For every non-`comment` proposal: `citations` is non-empty and every range falls inside an `ic`/`recap`/`mixed` segment of the source transcript.
- No proposal of kind `edit | create | append` targets `content/Rules/**`. Rules pages may appear as `relatedPath` in `comment` proposals but cannot be edited.
- `newText` (for `edit`) and `content` (for `create`/`append`) parse via `parseFrontmatter()` without throwing — frontmatter, where present, is valid YAML.
- New pages include frontmatter (`title:` and optionally `aliases:`/`tags:`) consistent with sibling pages: detected by walking up the path to find the nearest folder with `index.md` siblings and confirming the new page has at least the fields all siblings have.
- Running twice on the same transcript with deterministic fake LLM produces byte-identical output.

### Verification

- `bun test src/reconcile/propose.test.ts src/reconcile/cluster.test.ts src/reconcile/validate.test.ts src/cli/propose.test.ts` passes.
- Manual: apply 5 proposals against a clone of `content/` and verify the rendered output in an Obsidian-compatible previewer.

## What We're NOT Doing

- **Verification of citations vs. claim text.** That's ticket 010 (`tickets/010-verifier-pass.md`). The proposer only structurally validates that citations point into valid segments.
- **Merging duplicate proposals across multiple `update` candidate pages.** The same claim can produce two edit proposals (one per page). The verifier and the reviewer handle the redundancy.
- **Cross-transcript proposal merging.** Each transcript's proposals are independent. If two transcripts both propose creating `Org/X/People/Y.md`, the second one will fail apply later — handled by ticket 013, not here.
- **Cost-bounded chunking of large pages.** Pages are sent in full as the cached system context. If `Timeline.md` (~16 KB) is an `update` target we send the whole file. We rely on caching to keep cost down.
- **`--force` flag.** Re-running requires `bun run transcripts reset <name> --stage proposed`.
- **Editing wiki pages.** That's ticket 013 (apply step).
- **Choosing different `MODEL_PROPOSE` per cluster type.** All LLM-driven clusters use the same model.
- **A new ledger stage.** `proposed` already exists.
- **Touching the `content/Rules/` directory** in any output kind besides `comment`.
- **Auto-creating directories under `content/` that don't exist** — the LLM must propose paths whose parent directory already exists in the wiki index. (Sub-page creation under an existing `Org/X/People/` directory is fine; creating a brand-new top-level folder isn't.)
- **Speculative claims that match an existing page as `consistent`** — we don't even emit a comment for these. Comments are emitted only for `contradict` or for `speculative` claims whose match is `update` or `new`.

## Implementation Approach

Four phases that build cleanly on each other. Phases 1 and 3 have no live LLM calls and are fully testable with injected fakes. Phase 2 is the only LLM-burning phase. Phase 4 is the CLI wrapper.

1. **Clustering and deterministic outputs** — pure code. Groups match entries into clusters by output kind; emits alias-add edits and comment proposals directly.
2. **LLM proposer** — given an `update`-target cluster or a `new`-entity cluster, calls `MODEL_PROPOSE` with the cached wiki-conventions block + page text and returns an `edit | create | append` proposal.
3. **Validators** — `oldText` uniqueness, citation-in-extract-segments, no-Rules-target, frontmatter parses, sibling consistency for new pages. Invalid proposals are dropped with a warning (not silently).
4. **Orchestrator + CLI + persistence** — wires phases 1–3, writes `state/proposals/<filename>.json`, mutates the ledger, mirrors `src/cli/match.ts`.

---

## Phase 1: Clustering and Deterministic Outputs

### Overview

`src/reconcile/cluster.ts` consumes the match+resolution payloads and produces a list of typed clusters. Three of the cluster kinds are passthrough deterministic outputs (built without any LLM call), and two require an LLM call in phase 2.

Cluster kinds:

- `UpdateCluster` — one per `(targetPath, claims[])`; aggregates all `update`-relation candidate-page entries that point at the same path. Excludes any claim whose `confidence === 'speculative'`. → phase 2 produces `edit` or `append`.
- `CreateCluster` — one per `(primaryEntity, claims[])`; aggregates standalone-new claims (relation `new`, path `null`) sharing the same `primaryEntity`. Excludes `confidence === 'speculative'`. → phase 2 produces `create`.
- `AliasEditCluster` — one per `aliasSuggestion` from the resolutions file. Deterministic; converted directly to an `edit` proposal in this phase.
- `CommentCluster` — one per (claim, candidatePage) pair where `relation === 'contradict'`, OR where `claim.confidence === 'speculative'` AND the relation is `update` or `new`. Deterministic; converted to a `comment` proposal in this phase.

Skipped (no cluster, no output):

- `relation === 'consistent'`.
- `relation === 'new'` with `path !== null` (classifier said "doesn't belong on this page").
- `confidence === 'speculative'` claims whose only candidate pages are `consistent`.

### Changes Required

#### 1. New file: `src/reconcile/cluster.ts`

```ts
import type { Claim } from '../transcript/extract';
import type { MatchEntry } from './match';
import type { AliasSuggestion } from './resolve';

export type Citation = [number, number];

export interface UpdateCluster {
  kind: 'update';
  targetPath: string;
  claims: { claim: Claim; rationale: string; excerpt: string | null }[];
}

export interface CreateCluster {
  kind: 'create';
  primaryEntity: string;
  claims: { claim: Claim; rationale: string }[];
}

export interface AliasEditCluster {
  kind: 'alias-edit';
  targetPath: string;
  variantsToAdd: string[];        // canonical-deduped list of aliases to merge in
  citations: Citation[];          // claim lines that used each variant
}

export interface CommentCluster {
  kind: 'comment';
  reason: 'contradict' | 'speculative';
  relatedPath: string | null;
  claim: Claim;
  rationale: string;
  excerpt: string | null;
}

export type Cluster =
  | UpdateCluster
  | CreateCluster
  | AliasEditCluster
  | CommentCluster;

export interface ClusterInputs {
  matches: MatchEntry[];
  aliasSuggestions: AliasSuggestion[];
  claims: Claim[];                // canonical list from resolutions file
}

export interface ClusterStats {
  updateClusters:     number;
  createClusters:     number;
  aliasEditClusters:  number;
  commentClusters:    number;
  skippedConsistent:  number;
  skippedClassifierNew: number;   // relation:'new' with path != null
}

export interface ClusterResult {
  clusters: Cluster[];
  stats:    ClusterStats;
}

export function buildClusters(input: ClusterInputs): ClusterResult { /* ... */ }
```

**Behavioral specification** (matches the test cases below):

1. **`update` aggregation**: for each `MatchEntry`, for each `candidatePages[i]` where `relation === 'update'`:
   - If `claim.confidence === 'speculative'`: emit a `CommentCluster` with `reason: 'speculative'` instead; do NOT add to `UpdateCluster`.
   - Otherwise: push `{ claim, rationale, excerpt }` onto the `UpdateCluster` keyed by `candidatePages[i].path`. (`path` is guaranteed non-null when `relation === 'update'`.)

2. **`contradict`**: for every `(claim, candidatePages[i])` pair with `relation === 'contradict'`, emit a `CommentCluster` with `reason: 'contradict'`, `relatedPath: path`, regardless of confidence.

3. **`new` (standalone)**: for each match where `candidatePages.length === 1 && candidatePages[0].path === null`:
   - If `claim.confidence === 'speculative'`: emit a `CommentCluster` with `reason: 'speculative', relatedPath: null`.
   - Otherwise: pick the primary entity (algorithm below), accumulate into `CreateCluster[primaryEntity]`.

4. **`new` (classifier-rejected)**: `candidatePages[i].relation === 'new' && path !== null` — skipped; counted in `stats.skippedClassifierNew`.

5. **`consistent`**: skipped; counted in `stats.skippedConsistent`.

6. **Alias suggestions** (deterministic; emitted regardless of any other clustering):
   - Group by `targetPath = page` (skip aliasSuggestions with `page: null` if any exist).
   - Within a group, deduplicate `variantsToAdd` (case-insensitive, preserving first-seen casing).
   - Compute citations from claims in `input.claims` whose `entityResolutions[i].suggestAlias === true && entityResolutions[i].page === aliasSuggestion.page`. Use those claims' `lines` tuples.
   - If no citation claims found, drop the cluster with a `console.warn` (data inconsistency between aliasSuggestions and entityResolutions).

7. **Primary-entity selection for standalone-new**:
   - Filter `claim.entities` to those with a matching `entityResolutions[i]` where `page === null` (i.e. entities that found no canonical wiki page).
   - If none, fall back to `claim.entities[0]` (or skip if empty — count in stats and log warn).
   - For tie-breaking across the *transcript*: precompute an entity → occurrence-count map from all `input.claims` (count of entities with `page: null`). Highest count wins, alphabetical breaks ties.

#### 2. Convert deterministic clusters to proposals

A small helper in the same file (or in `src/reconcile/propose.ts` — see phase 2; I'll keep them together in `propose.ts`):

- `aliasEditClusterToProposal(cluster, pageText): EditProposal` — parses the page's existing frontmatter via `parseFrontmatter()`, computes the literal `oldText` and `newText`:
  - **Page has `aliases:`** in frontmatter: locate the existing `aliases:` block and append `  - <variant>` for each new variant. `oldText` is the existing `aliases:` block; `newText` is the modified one. Implementation: re-serialize with `yaml.stringify` only the aliases array section.
  - **Page lacks `aliases:`**: insert `aliases:\n  - <v1>\n  - <v2>\n` immediately after the opening `---` line. `oldText` is the literal first two lines (`---\n`) plus whatever follows on the second line; `newText` injects the block.
  - **Page lacks frontmatter entirely**: insert a full `---\naliases:\n  - <v>\n---\n` block at the top of the file.
- `commentClusterToProposal(cluster): CommentProposal` — straight passthrough: `{ kind: 'comment', reason, relatedPath, message, citations: [claim.lines] }`. The `message` is built from `rationale` + `excerpt` (if any) + the claim text.

The output proposal type is defined in phase 2.

#### 3. Tests: `src/reconcile/cluster.test.ts`

- **Update aggregation**: 3 claims with `relation:'update'` all targeting `Org/Iconoclasm/index.md` → 1 `UpdateCluster` with 3 entries.
- **Multi-page update**: 1 claim with two `update` candidates → it appears in two `UpdateCluster`s, one per target path.
- **Speculative update → comment**: claim with `confidence:'speculative'` and `relation:'update'` → emits a `CommentCluster(reason: 'speculative')`, not an `UpdateCluster`.
- **Contradict → comment**: claim with `relation:'contradict'` → `CommentCluster(reason: 'contradict')` regardless of confidence.
- **Standalone new clustered**: 3 standalone-new claims, two share `primaryEntity` "Dura Oil Drinker" → 2 `CreateCluster`s.
- **Speculative standalone-new → comment, not create.**
- **Classifier-`new`-with-path skipped**: incremented `skippedClassifierNew`.
- **Consistent skipped**: incremented `skippedConsistent`.
- **Alias edit construction**:
  - Page has `aliases:`: `oldText` is the existing block; `newText` adds new entries.
  - Page lacks `aliases:` in frontmatter: `newText` injects the block right after `---`.
  - Multiple variants for one page → one cluster with deduped variants.
  - No claim cites a variant (data inconsistency) → cluster dropped with warning.
- **Primary entity tie-breaking**: two entities with same count → alphabetical wins.
- **Empty entities fallback**: claim with `entities: []` → skipped + warn.
- **Determinism**: cluster order is stable (alphabetical by `targetPath` for update/alias-edit, by `primaryEntity` for create, by `(claim.lines, candidateIndex)` for comment).

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/cluster.test.ts` passes
- [x] `bun run typecheck` passes
- [x] No LLM calls in this phase (verified by injecting a fake `complete()` that throws if called)

---

## Phase 2: LLM Proposer

### Overview

`src/reconcile/propose.ts`. Given an `UpdateCluster` or `CreateCluster`, call `MODEL_PROPOSE` and return a proposal. The system context (cached) contains the wiki-conventions extract from `CLAUDE.md` plus — for updates — the full target page text. The user context lists the claims (one per line with the claim's `[lineStart-lineEnd]` so the LLM can cite back accurately).

The same module also exposes a `proposeCluster(cluster, ctx)` dispatch that handles all four kinds, delegating to deterministic builders for `alias-edit` / `comment` (from phase 1) and to LLM-driven builders for `update` / `create`.

### Changes Required

#### 1. Proposal type definitions

In `src/reconcile/propose.ts`:

```ts
import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { Cluster, UpdateCluster, CreateCluster, Citation } from './cluster';

export interface EditProposal {
  kind: 'edit';
  path: string;
  oldText: string;
  newText: string;
  citations: Citation[];
}

export interface CreateProposal {
  kind: 'create';
  path: string;
  content: string;
  citations: Citation[];
}

export interface AppendProposal {
  kind: 'append';
  path: string;
  afterHeading: string | null;   // null = append at EOF
  content: string;
  citations: Citation[];
}

export interface CommentProposal {
  kind: 'comment';
  reason: 'contradict' | 'speculative';
  relatedPath: string | null;
  message: string;
  citations: Citation[];
}

export type Proposal =
  | EditProposal
  | CreateProposal
  | AppendProposal
  | CommentProposal;
```

#### 2. Wiki-conventions cache

Read `CLAUDE.md` once at orchestrator start, slice the section starting with `## Content Files` up to the standalone `---\n\nDefault to using Bun` separator (line ~186):

```ts
export function loadConventions(claudeMdPath: string): Promise<string>;
```

The returned string is injected into the cached system block of every LLM call in this phase.

#### 3. LLM prompts and schemas

```ts
const PROPOSER_SYSTEM = [
  'You generate concrete wiki-page edits for a Pathfinder 2e campaign wiki.',
  'You will be given the current state of one page (or no page, for a new entity) and a list of claims',
  'extracted from session transcripts that should be reflected on that page.',
  '',
  'Output exactly ONE of the following:',
  '  - kind:"edit"   for a literal-substring replacement.',
  '                  oldText MUST be a verbatim substring of the page shown to you, appearing exactly once.',
  '                  newText is the replacement.',
  '  - kind:"append" for adding new content under an existing heading.',
  '                  afterHeading is the heading text (without the # prefix) where the content goes.',
  '                  Use null for end-of-file append.',
  '  - kind:"create" for proposing a new page (only when no page exists for the entity).',
  '',
  'Citations: for every claim you incorporate, include a [lineStart, lineEnd] pair in citations.',
  'Use the line ranges shown in the user message (the bracketed [start–end] before each claim).',
  'If a claim is not supported by any specific text you can quote, do NOT incorporate it.',
  '',
  'Follow the wiki conventions documented below verbatim — frontmatter, wikilinks, callouts, naming.',
  'Do NOT add information not stated in the claims. Do NOT propose edits to pages under content/Rules/.',
  '',
  '--- WIKI CONVENTIONS (from CLAUDE.md) ---',
  '{{CONVENTIONS}}',
].join('\n');

const ProposalOutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('edit'),
    oldText: z.string().min(1),
    newText: z.string(),
    citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
  }),
  z.object({
    kind: z.literal('append'),
    afterHeading: z.string().nullable(),
    content: z.string().min(1),
    citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
  }),
  z.object({
    kind: z.literal('create'),
    path: z.string().min(1),
    content: z.string().min(1),
    citations: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
  }),
]);
```

Note: only `create` outputs include `path` from the LLM; `edit` and `append` get `path` from the cluster context. This prevents the LLM from accidentally redirecting an edit to the wrong file.

#### 4. Cluster-to-LLM dispatch

```ts
export interface ProposerCtx {
  model: string;
  contentDir: string;
  conventions: string;
  transcript: string;
  completeFn?: typeof defaultComplete;
}

export async function proposeUpdate(c: UpdateCluster, ctx: ProposerCtx): Promise<EditProposal | AppendProposal | null>;
export async function proposeCreate(c: CreateCluster, ctx: ProposerCtx): Promise<CreateProposal | null>;
```

**`proposeUpdate`**:
- Loads `${contentDir}/${c.targetPath}` and asserts it exists.
- Cached block: `PROPOSER_SYSTEM` (with conventions injected) + `\n\n--- Target Page: ${c.targetPath} ---\n${pageText}`.
- User block: each claim formatted as ``[${lineStart}-${lineEnd}] ${claim.claim}`` — one per line — followed by the page-matcher's rationale per claim for context.
- LLM tool schema: discriminated union of `edit | append` only (reject `create` for update clusters: drop with warn).
- Returns `null` if LLM returns `create` for an update cluster or omits required fields.

**`proposeCreate`**:
- No page to load.
- Cached block: `PROPOSER_SYSTEM` + `\n\n--- New Page for entity: ${primaryEntity} ---\n` + a hint listing valid parent directories under `content/` (excluding `Rules/`), derived from the wiki index by enumerating existing directory paths.
- User block: claim list as above.
- LLM tool schema: `create` only.
- The LLM must return a `path` ending in `.md` that lives under one of the valid parent directories. The validator (phase 3) double-checks.

The dispatch entry point:

```ts
export async function proposeCluster(
  cluster: Cluster,
  ctx: ProposerCtx,
  pageTextLoader: (path: string) => Promise<string>,
): Promise<Proposal | null> {
  switch (cluster.kind) {
    case 'update':     return proposeUpdate(cluster, ctx);
    case 'create':     return proposeCreate(cluster, ctx);
    case 'alias-edit': return aliasEditClusterToProposal(cluster, await pageTextLoader(cluster.targetPath));
    case 'comment':    return commentClusterToProposal(cluster);
  }
}
```

#### 5. Tests: `src/reconcile/propose.test.ts`

- **Update → edit happy path**: fake LLM returns `{ kind: 'edit', oldText: '<existing text>', newText: '...', citations: [[100, 102]] }`. Proposal returned with `path` set from cluster.
- **Update → append happy path**: fake LLM returns `kind: 'append', afterHeading: '### Devotee Benefits'`.
- **Update → create rejected**: fake LLM mistakenly returns `kind: 'create'` for an update cluster → returns `null` with warn.
- **Create → create happy path**: fake LLM returns `{ kind: 'create', path: 'Org/Iconoclasm/People/Dura Oil Drinker.md', content: '---\n...', citations: [[200, 205]] }`.
- **Create → edit rejected**: fake LLM returns `kind: 'edit'` for a create cluster → returns `null` with warn.
- **Cached block is identical across calls**: spy on `complete()` invocations; the `cached` field for two different update clusters of the same page differs only in the page-text portion (the conventions block is the same).
- **Conventions block contains heading "## Content Files"**: assert substring presence after `loadConventions()`.
- **Alias-edit deterministic** (covered in cluster tests): re-run with same inputs → identical proposal.
- **Comment deterministic**: re-run with same inputs → identical message text.

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/propose.test.ts` passes
- [x] `bun run typecheck` passes
- [x] No proposal escapes phase 2 without a non-null result OR a logged warning

---

## Phase 3: Validators

### Overview

`src/reconcile/validate.ts`. Each proposal returned from phase 2 is sent through a sequence of validators. A failing validator drops the proposal (with `console.warn(reason)`) and increments a per-reason counter. The validators apply differently per kind.

Drop reasons are tracked in stats (`droppedByReason: Record<string, number>`) so we can audit how often the LLM is off-spec without surfacing them as proposals.

### Changes Required

#### 1. New file: `src/reconcile/validate.ts`

```ts
import type { Proposal, EditProposal, CreateProposal, AppendProposal, CommentProposal } from './propose';
import type { Segment } from '../transcript/segment';
import { parseFrontmatter } from '../wiki/frontmatter';
import type { WikiIndex } from '../wiki/index-schema';
import { EXTRACT_LABELS } from '../transcript/extract';

export interface ValidateCtx {
  contentDir: string;
  segments: Segment[];      // for the transcript this proposal came from
  wikiIndex: WikiIndex;     // for sibling consistency check
}

export type ValidateResult =
  | { ok: true;  proposal: Proposal }
  | { ok: false; reason: string };

export async function validateProposal(p: Proposal, ctx: ValidateCtx): Promise<ValidateResult>;
```

**Validation rules** (run in order; first failure short-circuits):

1. **Citations land in extract segments** (skip for `comment` — comments have looser citation requirements but still must point into extract segments).
   - For each `[start, end]` in `citations`: find a segment `s` such that `s.startLine <= start && s.endLine >= end && EXTRACT_LABELS.includes(s.label)`. Drop reason: `citation-not-in-extract-segment:<start>-<end>`.

2. **No Rules target** (applies to `edit | append | create`):
   - For `edit | append`: `path.startsWith('Rules/')` is forbidden. Drop reason: `target-in-rules`.
   - For `create`: `path.startsWith('Rules/')` is forbidden. Drop reason: `create-in-rules`.

3. **`edit`: `oldText` appears exactly once in target file**:
   - Load `${contentDir}/${path}`; count occurrences of `oldText` (literal `indexOf` loop). If `count !== 1`: drop reason `oldText-not-unique:count=N`.

4. **`edit`: target file exists** — implicit in step 3 (read fails → drop reason `target-missing`).

5. **`append`: target file exists**.
   - If `afterHeading !== null`: parse headings via `extractHeadings(body)`; require an exact-text match. Drop reason: `heading-not-found:<heading>`.

6. **`create`: path is fresh and under valid parent**:
   - `path` must NOT exist in `wikiIndex.pages`. Drop reason: `path-already-exists`.
   - The parent directory `path.split('/').slice(0, -1).join('/')` must exist (≥1 sibling in `wikiIndex.pages`). Drop reason: `parent-directory-missing`.

7. **Frontmatter parses** (`edit | create | append`):
   - For `edit`: derive the post-edit page text by `pageText.replace(oldText, newText)`; run `parseFrontmatter()`. Drop reason: `frontmatter-invalid-after-edit`.
   - For `create`: `parseFrontmatter(content)`. Drop reason: `frontmatter-invalid`.
   - For `append`: no frontmatter validation (append content doesn't touch frontmatter).

8. **Sibling frontmatter consistency** (`create` only):
   - Find siblings under the same parent in `wikiIndex.pages`. Compute the intersection of frontmatter keys across siblings (≥3 siblings required, else skip the check). New page's frontmatter must contain every key in the intersection. Drop reason: `missing-frontmatter-keys:<keys>`.

#### 2. Tests: `src/reconcile/validate.test.ts`

- **Citation in `ic` segment**: passes.
- **Citation in `recap` segment**: passes.
- **Citation in `mixed` segment**: passes.
- **Citation in `ooc` segment**: dropped.
- **Citation in `rules` segment**: dropped.
- **Citation spanning two segments where one is ic**: dropped (must fully lie within one extract segment).
- **`edit.oldText` appears twice**: dropped, reason `oldText-not-unique:count=2`.
- **`edit.oldText` appears zero times**: dropped, reason `oldText-not-unique:count=0`.
- **`edit.path` under `Rules/`**: dropped.
- **`append.afterHeading` doesn't exist in target**: dropped.
- **`append.afterHeading: null` (EOF append)**: passes regardless of headings.
- **`create.path` already in wiki index**: dropped.
- **`create.path` parent missing**: dropped (e.g. `New Folder/Page.md` when `New Folder/` has no other md files).
- **Frontmatter invalid YAML after edit**: dropped.
- **Frontmatter parses after edit**: passes.
- **Sibling consistency**: 4 siblings all have `title:`; new page lacks `title:` → dropped.
- **Sibling consistency skipped with < 3 siblings**: passes even if the new page omits common keys.

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/validate.test.ts` passes
- [x] `bun run typecheck` passes
- [x] Every drop path increments `droppedByReason[reason]` and logs `console.warn`

---

## Phase 4: Orchestrator + CLI + Persistence

### Overview

`src/cli/propose.ts` mirrors `src/cli/match.ts` line for line. The orchestrator inside (`src/reconcile/propose.ts::proposeTranscript`) wires cluster→propose→validate and assembles the output JSON + stats.

### Changes Required

#### 1. Orchestrator: `proposeTranscript` in `src/reconcile/propose.ts`

```ts
export interface ProposeTranscriptOptions {
  model: string;
  contentDir: string;
  conventionsPath: string;          // path to CLAUDE.md (or pre-extracted conventions file)
  transcript: string;
  completeFn?: typeof defaultComplete;
  onClusterProposed?: (cluster: Cluster, proposal: Proposal | null) => void | Promise<void>;
}

export interface ProposeTranscriptResult {
  proposals: Proposal[];
  stats: {
    totalClusters:        number;
    updateClusters:       number;
    createClusters:       number;
    aliasEditClusters:    number;
    commentClusters:      number;
    proposalsByKind:      { edit: number; append: number; create: number; comment: number };
    droppedByReason:      Record<string, number>;
    llmCalls:             number;
  };
}

export async function proposeTranscript(
  matches: MatchEntry[],
  resolutions: { claims: Claim[]; aliasSuggestions: AliasSuggestion[] },
  segments: Segment[],
  wikiIndex: WikiIndex,
  opts: ProposeTranscriptOptions,
): Promise<ProposeTranscriptResult>;
```

Flow:
1. Build clusters (phase 1) — `buildClusters({ matches, claims: resolutions.claims, aliasSuggestions: resolutions.aliasSuggestions })`.
2. For each cluster: `proposeCluster()` → either a `Proposal` or `null`.
3. For each non-null `Proposal`: `validateProposal()` → either kept or dropped.
4. Return assembled list + stats.

#### 2. CLI: `src/cli/propose.ts`

Mirrors `src/cli/match.ts` exactly (same `--all` flow, same stale-claims-guard pattern, same error-recording on failure):

```ts
const TRANSCRIPTS_DIR  = 'transcripts';
const LEDGER_PATH      = 'state/processed.json';
const RESOLUTIONS_DIR  = 'state/resolutions';
const MATCHES_DIR      = 'state/matches';
const SEGMENTS_DIR     = 'state/segments';
const PROPOSALS_DIR    = 'state/proposals';
const CONTENT_DIR      = 'content';
const WIKI_INDEX_PATH  = 'state/wiki-index.json';
const CLAUDE_MD_PATH   = 'CLAUDE.md';
```

Behavior:

- `bun run propose <name>` (or substring): error if `stages.matched === null`; read matches file + resolutions file + segments file; verify the matches file's `contentHash === entry.contentHash` and `claimsContentHash` matches the resolutions file; run `proposeTranscript`; write `state/proposals/<filename>.json` atomically; `markStage('proposed')`.
- `bun run propose --all`: iterate entries with `stages.matched !== null && stages.proposed === null` and file on disk.
- No `--force`.

Stale-input guard:

```ts
const matchesData = JSON.parse(await Bun.file(`${ctx.matchesDir}/${entry.filename}.json`).text());
if (matchesData.contentHash !== entry.contentHash) {
  throw new Error(`transcript changed since match — reset stages and re-match before proposing`);
}
const resolutionsData = JSON.parse(await Bun.file(`${ctx.resolutionsDir}/${entry.filename}.json`).text());
if (resolutionsData.contentHash !== entry.contentHash) {
  throw new Error(`transcript changed since resolution — reset stages and re-resolve before proposing`);
}
```

**Output JSON shape** (`state/proposals/<filename>.json`):

```json
{
  "filename": "000.through-a-song-darkly.2025-8-28.txt",
  "contentHash": "76456b04...",
  "matchesContentHash": "76456b04...",
  "stats": {
    "totalClusters": 53,
    "updateClusters": 12,
    "createClusters": 8,
    "aliasEditClusters": 3,
    "commentClusters": 6,
    "proposalsByKind": { "edit": 12, "append": 3, "create": 8, "comment": 6 },
    "droppedByReason": { "oldText-not-unique:count=0": 2, "frontmatter-invalid": 1 },
    "llmCalls": 20
  },
  "proposals": [
    { "kind": "edit", "path": "Org/Iconoclasm/People/Elias Ramsey.md", "oldText": "...", "newText": "...", "citations": [[1234, 1236]] },
    { "kind": "create", "path": "Org/Iconoclasm/People/Dura Oil Drinker.md", "content": "---\n...", "citations": [[2001, 2008], [2020, 2024]] },
    { "kind": "append", "path": "Org/Iconoclasm/index.md", "afterHeading": null, "content": "...", "citations": [[3001, 3003]] },
    { "kind": "comment", "reason": "contradict", "relatedPath": "Org/Roundhat Gang/index.md", "message": "...", "citations": [[4001, 4002]] }
  ]
}
```

**Debug output** (`state/proposals/_debug/<filename>/<idx>.<kind>.<slug>.json`, gitignored):

One file per LLM call (update/create). Contents: the cluster, the cached block (truncated head/tail), the raw LLM output, and whether validation passed.

#### 3. Register in CLI map: `src/cli/index.ts`

```ts
import { propose } from './propose';
// ...
export const handlers: Record<string, CliHandler> = {
  // ... existing ...
  'propose': propose,
};
```

#### 4. Add script: `package.json`

```json
"propose": "bun index.ts propose"
```

#### 5. Update `.gitignore`

Append:

```
state/proposals/_debug/
```

Do NOT gitignore `state/proposals/` itself — committed proposal outputs follow the same convention as `state/matches/`.

#### 6. CLI tests: `src/cli/propose.test.ts`

Use injected fake `completeFn` and tmp directories. Cover:

- Single-transcript run writes `state/proposals/<name>.json`, sets `stages.proposed`.
- `--all` skips transcripts whose `stages.proposed` is already set.
- `--all` skips transcripts whose `stages.matched` is null.
- `--all` continues past a single-transcript failure, records the error, exits non-zero.
- Stale matches detection: matches file `contentHash` doesn't match ledger → throws with helpful message; ledger records the error.
- Stale resolutions detection: same for resolutions file.
- Missing matches/resolutions file → throws with helpful message.
- Running twice with deterministic fake LLM produces byte-identical output.
- Debug files are written per LLM cluster invocation.

#### 7. Summary line

```
proposed 000.through-a-song-darkly.2025-8-28.txt: 29 proposals — 12 edit, 3 append, 8 create, 6 comment from 53 clusters (3 dropped: oldText-not-unique=2, frontmatter-invalid=1), 20 LLM calls
```

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/propose.test.ts` passes
- [x] All tests pass: `bun test`
- [x] Type check passes: `bun run typecheck`
- [x] `bun run propose` with no args prints usage and exits non-zero
- [x] Running `bun run propose <name>` twice on the same transcript produces byte-identical `state/proposals/<name>.json`
- [x] Every `edit` proposal's `oldText` is found exactly once in the target file (validator enforces; CI test runs over real `state/matches/` output)
- [x] Every non-`comment` proposal has non-empty `citations`, and all ranges fall inside `ic`/`recap`/`mixed` segments
- [x] No `edit`/`create`/`append` proposal targets `content/Rules/`
- [x] Generated `newText` (post-edit page text) parses via `parseFrontmatter()` without throw
- [x] New pages' frontmatter contains every key present in all siblings (when ≥3 siblings exist)

#### Manual Verification
- [ ] `bun run propose 000.through-a-song-darkly.2025-8-28` runs without error.
- [ ] Apply 5 proposals against a clone of `content/` (a checked-out branch); render in Obsidian or an Obsidian-compatible previewer (Foam, Logseq, etc.); confirm wikilinks resolve and callouts render.
- [ ] Spot-check 5 `edit` proposals: the change reads as a natural extension of the existing prose, with citations that map back to GM lines in the transcript.
- [ ] Spot-check 3 `create` proposals: frontmatter matches sibling patterns; body uses wikilinks on first mention of notable nouns; no Bun lint issues if run through `bun run typecheck` (irrelevant for markdown but checks the page parses).
- [ ] At least one `comment` proposal for a deliberately injected contradiction reads correctly and references the right page.
- [ ] `bun run cost-report` shows `propose` stage entries; cost is in expected range ($1–$3 per transcript).
- [ ] `bun run transcripts list` shows the `prop` column set for the processed transcript.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that 5 proposals render correctly in Obsidian before running `--all` against all 36 outstanding transcripts.

---

## Testing Strategy

### Unit Tests

- **Phase 1 — clustering**: update aggregation, multi-page updates, speculative routing, contradict routing, standalone-new clustering, alias-edit deterministic construction (with/without existing aliases, with/without frontmatter), classifier-`new` skipped, consistent skipped, primary-entity tie-breaking.
- **Phase 2 — proposer**: update→edit, update→append, create→create, cross-kind misroute drops, cached block stability, conventions block presence, deterministic alias-edit/comment paths.
- **Phase 3 — validators**: every drop reason has a test; segment-label whitelist; oldText uniqueness edges (0, 2, 1); Rules exclusion; create-path freshness; sibling frontmatter intersection.
- **Phase 4 — CLI**: same shape as `src/cli/match.test.ts`.

### Integration Tests

The CLI tests in phase 4 exercise cluster → propose → validate → atomic write → ledger end-to-end with an injected fake `complete()`. A separate test uses the real `state/matches/000.through-a-song-darkly.2025-8-28.txt.json` as input and verifies that every emitted `edit.oldText` is actually found in the corresponding `content/` file.

### Manual Testing Steps

1. `bun run propose 000.through-a-song-darkly.2025-8-28` — verify zero errors.
2. Open `state/proposals/000.through-a-song-darkly.2025-8-28.txt.json` and scan stats. Confirm:
   - `updateClusters > 0`
   - `commentClusters` matches the contradict + speculative claim count in matches
   - `droppedByReason` is small (single-digit drops at most for the first run; investigate any >5)
3. Pick 5 `edit` proposals. For each: open the target page, find `oldText`, mentally apply `newText`, confirm the result reads naturally.
4. Pick 3 `create` proposals. Compare frontmatter to siblings under the same parent directory.
5. Find at least one `append` proposal. Confirm the heading exists in the target page.
6. Apply all proposals to a clone of `content/`:
   ```bash
   cp -r content content.bak
   # apply proposals manually or via a one-off script
   ```
   Open in Obsidian or Foam; confirm rendering.
7. `bun run cost-report` — confirm `propose` stage cost.
8. After spot-check passes: `bun run propose --all`.

---

## Performance Considerations

- **Per-transcript LLM cost**: ~20–30 unique-page update clusters + ~10–20 create clusters per transcript. At Sonnet 4.6 with cached conventions block (~6 KB) + cached page text (~2 KB avg): ~$0.05/call → ~$1.50–$2.50/transcript.
- **Across 36 outstanding transcripts**: ~$55–$90. Roughly equivalent to the match-stage cost from ticket 008.
- **Cache hit rate**: the conventions block is identical across every call in a run; the page-text block is identical for any cluster targeting the same page. First-call cache write is amortized over subsequent calls.
- **Wall-clock**: ~30 calls/transcript × 3s = 90s. 36 transcripts = ~55 minutes sequential. Acceptable.
- **Memory**: each `proposeTranscript` run holds the wiki index (~200 KB), one transcript's matches+resolutions+segments (~50 KB combined), and on-demand page text. Bounded.

## Migration Notes

- The previously matched transcript (`000.through-a-song-darkly.2025-8-28.txt`) is ready for proposal; its `stages.matched` is set. Running `bun run propose 2025-8-28` will produce the first proposals file.
- Per the memory `[[ticket-015-naming-resolution-complete]]`: 36 transcripts still need `resolve` → `match` to run before they're eligible for `propose`. No action required from this plan — the `propose --all` filter handles that automatically.
- No schema changes to existing files. `state/matches/<file>.json` and `state/resolutions/<file>.json` formats are stable inputs.

## References

- Original ticket: `tickets/009-edit-proposal-generation.md`
- Parent epic: `tickets/001-create-project.md`
- Predecessor plans: `thoughts/shared/plans/2026-05-17-008-claim-to-page-matching.md`, `thoughts/shared/plans/2026-05-18-015-naming-resolution.md`
- Successor ticket: `tickets/010-verifier-pass.md`
- LLM wrapper: `src/llm.ts:33`
- CLI pattern to mirror: `src/cli/match.ts:1`
- Match output schema: `src/reconcile/match.ts:8`
- Resolutions schema: `src/reconcile/resolve.ts:7`, plus aliasSuggestions per ticket 015
- Segment schema: `src/transcript/segment.ts:18`
- Extract labels constant: `src/transcript/extract.ts:10`
- Frontmatter parser: `src/wiki/frontmatter.ts:10`
- Wiki conventions source: `CLAUDE.md:2-186`
- Ledger `proposed` stage: `src/transcript/ledger.ts:11`
- Existing match output sample: `state/matches/000.through-a-song-darkly.2025-8-28.txt.json`
