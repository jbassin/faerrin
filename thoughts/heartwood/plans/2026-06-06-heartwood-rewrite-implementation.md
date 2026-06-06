# Heartwood Rewrite — Implementation Plan

**Date:** 2026-06-06
**Spec:** [`thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md`](../specs/0001-heartwood-rewrite-spec.md) (ratified v1.0)
**Status:** ready to implement

## Overview

Replace the rejected 7-stage PR-shipping heartwood pipeline with a two-part system:
1. **`@faerrin/heartwood` (rewritten core)** — a headless Bun library + thin CLI that ingests a
   session transcript, mines transcript-cited claims with epistemic modality, triages
   canon/noise, resolves entities/aliases, builds per-page proposals, detects cross-arc
   conflicts (entity-scoped), and maintains the **Canon Ledger** + a **render-invisible
   provenance sidecar**.
2. **`@faerrin/heartwood-review` (new app)** — a standalone local-first **TanStack Start (SSR)
   + React** review app. The worldbuilder reviews proposals **rendered in aether's voice**,
   verifies each sentence against cited transcript lines on hover, edits prose in place,
   approves, and commits one batched **jj** revision per session. No GitHub PRs.

The guiding principle from the spec: **the machine structures and cites; the human keeps the
pen on the prose.** This plan maps every task to spec acceptance criteria (AC-*) and honors the
12 ratified decisions (D-*).

> Package-naming note: the core keeps the name `@faerrin/heartwood`; the app is introduced as
> `@faerrin/heartwood-review` (folder `pkg/heartwood-review`). A codename (à la aether/strider)
> may replace `heartwood-review` later — it does not affect the plan. The app depends on the
> core via the workspace (`@faerrin/heartwood`) and calls it from **server functions**.

## Current State Analysis

The existing `pkg/heartwood` is a Commander CLI implementing `index-wiki → segment → extract →
resolve → match → propose → submit → respond`, writing per-stage JSON under `state/` and
shipping GitHub PRs. It was rejected for edit quality, review burden, wrong surface (PRs), and
coverage (§1 of the spec).

**Crucially, the rewrite is not greenfield** — a research pass produced a salvage inventory:

### Key Discoveries (salvage map)

Reusable **as-is** (lift into the rewritten core):
- `src/llm.ts` — `complete()` wrapper over `@faerrin/llm` (Zod tool-schema, `temperature:0`,
  ephemeral caching, cost recording). Stage name is a free string; zero pipeline coupling.
- `src/log.ts` + pricing — per-run JSONL cost log (`recordLLMCall`, `summarize`,
  `latestRunFile`). Reuse verbatim.
- The entire `src/wiki/` subsystem: `load.ts` (`loadWikiIndex`, `Script/` exclusion at
  `load.ts:79`, `mergeIndex`/`diffIndex` incremental rebuild), `frontmatter.ts`
  (`parseFrontmatter` — extracts `aliases`), `wikilinks.ts` (`extractWikilinks` regex
  `/\[\[([^\]\n]+?)\]\]/g`, `extractHeadings`), `index-schema.ts` (`PageRecord`/`WikiIndex`),
  `hash.ts` (`sha256Hex`). **`buildLookupMaps()` already produces `titleMap` + `aliasMap`
  (`load.ts:128`)** — the seed for entity/alias resolution (AC-20).
- `src/transcript/discover.ts` — **`parseFilename()` (`discover.ts:25`) already returns
  `{campaignId, campaignName, sessionDate}` = our `(arc, date)` identity (D-9)** and ISO-pads
  the date; `discoverTranscripts()` hashes bytes.
- `src/transcript/speakers.ts` — `parseSpeakers()` (`speakers.ts:13`) parses the canonical
  `NNNNNN\tSpeaker: text` line format → the `(transcript, lineId)` citation primitive (C8).
- `src/transcript/chunk.ts` — `chunkTranscript()` sliding window preserving line prefixes
  (bounded-cost input windows, C1).
- Conventions: Zod-at-IO-boundary, `completeFn?`/`writeLedgerFn?` dependency injection for
  tests, `tmp → rename` atomic writes, `test-setup.ts` + `bunfig.toml` env preload, co-located
  `*.test.ts` with inline factories.

Reusable **with changes**:
- `src/config.ts` — keep the frozen-singleton + `_resetConfigForTests` loader; **drop required
  `GITHUB_TOKEN`/`GITHUB_REPO`/`GITHUB_API_URL`**; redesign the `MODEL_*` keys for the new
  stages.
- The ledger (`src/transcript/ledger.ts`) — keep `contentHash` reconcile logic, atomic writes,
  `markStage`/`recordError`/`findEntry`; **re-key from `filename` to `(arc, date)`**; replace
  the `STAGE_ORDER`/PR fields with the new stages.

**Retire** (delete): `src/github/*` (client, submissions, dry-run), `src/cli/{submit,respond}`,
`src/reconcile/*`, `src/transcript/{segment,extract,worthiness}.ts`, and the old per-stage
`state/{segments,claims,resolutions,matches,proposals,submissions}/` artifacts.

### Key Discoveries (review-app substrate)

- **strider** is the TanStack template to mirror: `@tanstack/react-start ^1.168`,
  `@tanstack/react-router ^1.170`, React 19, Vite 8. **Phantom deps must be declared**:
  `@tanstack/router-generator`, `@eslint/js`. tsconfig extends `tsconfig.base.json`, adds
  `dom` lib + `react-jsx`, and **excludes `scripts/`** so Node-only code doesn't contaminate
  the DOM-typed compile.
- strider runs in **static prerender** with **no server functions**; its fs-write path is a
  separate Bun sidecar. **We diverge here (D-8/app-I/O decision): run TanStack Start in SSR
  mode and use `createServerFn`** for all server-side I/O (read content, write the provenance
  sidecar, run `jj`). This is new territory in this repo — Phase 0a includes a server-function
  spike. The app is a **local-first dev tool**: `vite dev`/SSR server, **not Caddy-served**,
  not added to `sites.caddyfile`.
- **aether render reuse (D-8):** aether's Obsidian transforms are plain importable ES modules —
  `src/lib/remark-callouts.mjs`, `remark-wikilinks.mjs`, `remark-transcript.mjs`,
  `directive-handlers.mjs`, and the isomorphic `slug.ts`. A `renderWikiMarkdown(md, allSlugs)`
  wrapper can `unified().use(...)` these to produce HTML. Caveats: `content-paths.mjs` does a
  module-load `fs` walk, so **inject `allSlugs` explicitly** instead of importing it; **copy
  the compiled callout/link/typography CSS** (`callouts.scss`, `base.scss` `a.internal` +
  type rules); Astro's `render()` itself is not reusable, so we build our own
  remark→rehype→stringify. Bar is **visually faithful**, validated against a golden sample of
  aether-built pages — not byte-identical.

## Desired End State

- `bun run --filter @faerrin/heartwood ingest <arc> <date>` (and `--all`) produces, for a
  session, a reviewable proposal set with cited claims, resolved entities, and conflict flags —
  all under the new `state/` model keyed by `(arc, date)` + `contentHash`.
- `bun run --filter @faerrin/heartwood-review dev` serves the review app; the worldbuilder
  completes a session review and the approved changes land as **one jj revision** touching
  `pkg/content/wiki/**`, with provenance written to the sidecar and **zero change to aether's
  763-file build** (verified by a build + file-set diff).
- The coverage/slop **eval gate** reports numbers against a hand-labeled set, and CI
  (`dagger call check`) stays green (typecheck + tests across the workspace).

**Verification of the end state:** the Phase success criteria below, plus the spec's AC-1..AC-26.

## What We're NOT Doing

- **No GitHub PRs, comment threads, or CI merge gate** (N1; retire `src/github`).
- **No change to aether's render output / build** in v1 (C6) — provenance is a render-invisible
  sidecar (D-1); aether is not modified.
- **No `Timeline.md` automation** (D-3) — retcons update the page only; Timeline stays manual.
- **No structured-canon-graph v2 / aether renderer inversion** (spec §15 deferred).
- **No multi-reviewer workflow, no autonomous commits, no in-session live capture, no
  transcript correction** (N2–N7).
- **No editing of `Script/` pages** (N5; reuse the existing `Script/` exclusion).
- **No Caddy/production deployment of the review app** — it is local-first.

## Implementation Approach

Salvage the proven infra into a clean core, build the pipeline stages the spec actually needs
(mine → triage → resolve → locate → conflict → assemble), persist a ledger + provenance
sidecar, then build the SSR review app on top via server functions that call the core
in-process. Land P0 acceptance criteria in Phases 0–2; depth (P1) in Phase 3; quality/voice
(P2) in Phase 4. Gate every phase on typecheck + `bun test`, and gate pipeline changes on the
eval set from Phase 0b.

---

## Phase 0a: Spikes, decisions, and scaffolding

### Overview
De-risk the two new-territory pieces and stand up both package skeletons before feature work.
Maps to spec §16 Phase 0a; unblocks everything.

### Changes Required

#### 1. Rewritten core package skeleton
**Files:** `pkg/heartwood/package.json`, `tsconfig.json`, `src/` (new tree)
- Keep `@faerrin/heartwood` name. Scripts: `ingest`, `eval`, `typecheck` (`tsc --noEmit`),
  `test` (`bun test`). Remove `index-wiki/segment/.../submit/respond` scripts and `GITHUB_*`.
- New `src/` layout: `core/llm.ts` `core/log.ts` `core/config.ts` `core/hash.ts` (salvaged);
  `wiki/*` (salvaged); `transcript/{discover,speakers,chunk}.ts` (salvaged);
  `pipeline/{mine,triage,resolve,locate,conflict,assemble}.ts` (new);
  `state/{ledger,provenance,store}.ts` (new); `anchor/anchor.ts` (new); `cli/*`.

#### 2. Sentence-anchor module (D-1 detail → **content-hash + fuzzy re-anchor**)
**File:** `pkg/heartwood/src/anchor/anchor.ts`
**Changes:** implement a durable anchor that never marks the prose.
```ts
// Anchor = { headingPath: string[]; ordinal: number; normHash: string; norm: string }
// normalize: trim, collapse whitespace, strip wikilink syntax/markdown emphasis, lowercase.
export function anchorFor(page: ParsedPage, sentenceIndex: number): SentenceAnchor
// Re-anchor on re-read: exact normHash match → same sentence; else fuzzy (token Jaccard /
// Levenshtein ratio ≥ threshold) within the same headingPath → update anchor; else mark stale.
export function reanchor(page: ParsedPage, a: SentenceAnchor): { idx: number | null; stale: boolean }
```
- Sentence segmentation must be deterministic and stable (single, documented splitter).
- **Spike test:** take 3 real wiki pages, apply representative manual edits (insert a sentence,
  reword a neighbor, add a heading), assert anchors re-resolve or flag stale correctly.

#### 3. aether-faithful render wrapper (D-8 → **reuse aether's plugins**)
**File:** `pkg/heartwood-review/src/render/renderWikiMarkdown.ts`
```ts
// unified().use(remarkParse).use(remarkGfm).use(remarkDirective)
//   .use(remarkCallouts).use(remarkWikilinks, { allSlugs }).use(remarkTranscript)
//   .use(remarkRehype, { handlers: directiveHandlers }).use(rehypeStringify)
export async function renderWikiMarkdown(md: string, srcSlug: string, allSlugs: string[]): Promise<string>
```
- Import aether's `remark-*.mjs` + `slug.ts`; **inject `allSlugs`** (don't import
  `content-paths.mjs`). Copy `callouts.scss` + the needed `base.scss` rules into the app.
- **Validation harness:** render N sample pages and diff against aether's built HTML
  (normalize away heading-anchor ids / smartypants if needed); record acceptable deltas.

#### 4. Review-app skeleton + server-function I/O spike
**Files:** `pkg/heartwood-review/{package.json,tsconfig.json,vite.config.ts,eslint.config.mjs,vitest.config.ts}`, `src/routes/{__root,index}.tsx`, `src/router.tsx`, `src/server/*.ts`
- Mirror strider's scaffold (declare `@tanstack/router-generator`, `@eslint/js`; extend
  `tsconfig.base.json`; `dom` lib; exclude `scripts/`). **Run TanStack Start in SSR mode.**
- Spike one `createServerFn` that (a) reads a file under `pkg/content`, (b) writes a temp
  sidecar file, (c) runs `jj --no-pager status` via `Bun.spawn` and returns stdout — proving
  read + write + shell from a server function.

### Success Criteria

#### Automated
- [ ] Both packages typecheck: `bun --filter @faerrin/heartwood typecheck` and
      `bun --filter @faerrin/heartwood-review typecheck`.
- [ ] `bun install` resolves with no phantom-dep errors (router-generator, @eslint/js declared).
- [ ] Anchor spike test passes: `bun --filter @faerrin/heartwood test src/anchor`.
- [ ] Render-validation harness runs and reports deltas: `bun --filter @faerrin/heartwood-review test src/render`.
- [ ] Server-function I/O spike test passes (reads content, writes sidecar, returns `jj status`).
- [ ] Workspace still green: `dagger call check`.

#### Manual
- [ ] `bun --filter @faerrin/heartwood-review dev` starts an SSR server and the index route loads.
- [ ] Rendered sample page is **visually faithful** to the live aether page (callouts, internal
      links, `::` stat block, `<pre>` flavor doc) — eyeball against `heart.iridi.cc`.
- [ ] Anchor re-resolution behaves sensibly on a hand-edited page.

**Implementation Note:** pause for human confirmation that the render is visually faithful and
the server-function I/O model is acceptable before building features on it.

---

## Phase 0b: Evaluation harness & labeled corpus  (AC-19)

### Overview
Stand up the coverage/slop metric so all later pipeline work is tuned against numbers, not
vibes. Spec §12, §16 Phase 0b.

### Changes Required

#### 1. Eval label format + fixtures
**Files:** `pkg/heartwood/eval/labels/<arc>.<date>.json`, `pkg/heartwood/eval/README.md`
- Worldbuilder hand-labels **~2 sessions across ≥2 arcs** (D-12): the set of canon facts that
  *should* be captured (for recall) and, optionally, exemplar good/bad sentences (for slop
  calibration). Define a small, documented schema.

#### 2. Eval runner
**File:** `pkg/heartwood/src/cli/eval.ts`
- `bun run eval [<arc> <date>]` runs mine+triage+resolve on a labeled session and reports:
  **coverage/recall** (% labeled canon facts surfaced), **false-canon rate** (canon-modality
  claims that aren't real canon), and a **slop-rate** placeholder (reviewer-decision-based;
  wired fully in Phase 4). Output a markdown summary + machine-readable JSON.
- Establish the **baseline to beat**: old pipeline ≈ 52% coverage.

### Success Criteria

#### Automated
- [ ] `bun --filter @faerrin/heartwood run eval` executes and emits coverage + false-canon numbers.
- [ ] Eval label schema is Zod-validated at load; malformed labels fail loudly.
- [ ] Typecheck + tests pass.

#### Manual
- [ ] At least 2 labeled sessions across 2 arcs exist and are committed.
- [ ] The worldbuilder agrees the labels represent "what should have been captured."

**Implementation Note:** this is the gate for all later pipeline phases — confirm the metric is
trusted before proceeding.

---

## Phase 1: Headless core pipeline  (AC-3, AC-5, AC-15, AC-20, AC-25)

### Overview
Turn a transcript into reviewable, cited, entity-resolved proposals with provenance — no UI yet.

### Changes Required

#### 1. New identity, ledger, and store
**Files:** `src/state/ledger.ts`, `src/state/store.ts`
- Session identity = `(arc, date)` from `parseFilename` + `contentHash` (C8/C9). Re-key the
  salvaged ledger; new `stages: { mined, triaged, resolved, located, conflicted, assembled }`.
- `store.ts`: atomic per-session artifact storage replacing the old per-stage dirs.
- **Idempotent re-ingest (AC-25):** on `contentHash` change, re-anchor existing provenance into
  the session or flag stale; do not re-propose already-approved facts.

#### 2. Mine stage (AC-3, AC-5)
**File:** `src/pipeline/mine.ts` — model `MODEL_MINE` (Sonnet-class) via `complete()`
```ts
// Claim { id; text; citations: {transcript; start; end}[]; speaker; role;
//         modality: 'gm-stated'|'player-speculation'|'in-character-fiction'|'uncertain'|'noise';
//         entitySurfaceForms: string[] }
```
- Chunked input (`chunkTranscript`), line-prefixed so the model emits `(transcript, lineId)`
  citations. **Every claim carries a modality** (AC-5) and ≥1 citation; an uncited claim is
  invalid. Cheap heuristic noise pre-pass before the LLM (C1).
- **Setting-fact filter (spec §5):** mine extracts durable world-state facts and **excludes
  session-event / party-action narrative**, pulling the standing fact out of an event. This is
  orthogonal to modality and was the dominant false-positive in label drafting (worldbuilder
  kept 80/142, cutting exactly the event entries). Encode it in the mine prompt; the eval
  coverage/false-canon scoring measures it.
- **In-character fiction (D-10):** `in-character-fiction`/GM-voiced claims are minted as
  **attributed** ("X claimed Y"), not bare propositions.

#### 3. Triage classification (feeds AC-1)
**File:** `src/pipeline/triage.ts`
- Sort claims → **Canon / Uncertain / Noise** (D-4 conservative: borderline → Uncertain).
  Persist with claim status; the UI confirms (Phase 2).

#### 4. Entity / alias resolution (AC-20)
**File:** `src/pipeline/resolve.ts`, `src/state/entities.ts`
- Seed an entity registry from the wiki `aliasMap` + `titleMap` (salvaged `buildLookupMaps`).
- Map each claim surface form → canonical `entity.id` (+ `wikiPath` if known). **Low-confidence
  merges are flagged for human confirm, never auto-merged** (AC-20, R7). Confirmed aliases are
  written back to the registry (and, on commit, can extend `aliases:` frontmatter).

#### 5. Locate + assemble proposals
**Files:** `src/pipeline/locate.ts`, `src/pipeline/assemble.ts`
- Locate: resolved entity → existing page or `create` proposal. Assemble per-page proposals
  (`kind: create|amend|correct|retract`, `targetPaths[]` for multi-page) backed by claim ids.
  Generate a **per-session narrative summary** (feeds AC-23). No prose generation yet (D-5).

#### 6. Provenance sidecar + Canon Ledger (AC-15)
**File:** `src/state/provenance.ts`
- Render-invisible **sidecar** keyed by `(wikiPath, sentenceAnchor)` (D-1), storing
  `{sessionId:(arc,date), citations, claimId, entityIds, arc, approvedAt}`. Best-effort /
  self-healing via the anchor module. Authoritative-for-reading remains the prose.

#### 7. CLI orchestrator
**File:** `src/cli/ingest.ts` — `ingest [<arc> <date>] [--all] [--force <stage>] [--stop-before <stage>]`
- `*One` throws on precondition failure; `--all` catches → `recordError` → continues → summary
  (salvaged error-handling convention).

### Success Criteria

#### Automated
- [ ] `bun run ingest <arc> <date>` produces claims (all cited + modality-tagged), resolved
      entities, proposals, narrative summary, and a provenance sidecar.
- [ ] Re-running with unchanged bytes is a no-op; changing bytes re-anchors / flags stale and
      does not re-propose approved facts (AC-25) — covered by tests.
- [ ] No claim lacks a `(transcript, lineId)` citation (AC-3) — asserted in tests.
- [ ] Player-speculation / in-character claims are never emitted as `gm-stated` canon (AC-5);
      IC claims are attributed (D-10) — asserted in tests.
- [ ] Low-confidence entity merges are surfaced, not auto-applied (AC-20) — asserted in tests.
- [ ] `bun run eval` coverage **beats the 52% baseline** on the labeled set.
- [ ] Typecheck + `bun test` pass; `dagger call check` green.

#### Manual
- [ ] Spot-check a session's claims: citations point at the right lines; modality is sane.
- [ ] Entity resolution merges obvious alias variants and flags genuinely ambiguous ones.

**Implementation Note:** pause for human confirmation of claim/entity quality (against the eval
numbers) before building the UI on top.

---

## Phase 2: Review app MVP  (AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-23)

### Overview
The actual product: review proposals as rendered prose, verify via citations, edit in place,
commit via jj. All P0 review criteria.

### Changes Required

#### 1. Server functions over the core (app-I/O decision: `createServerFn`)
**File:** `pkg/heartwood-review/src/server/*.ts`
- `listSessions`, `getSession(arc,date)` (proposals + narrative + claims + conflicts),
  `getTranscriptLines(transcript, range)`, `renderProposal` (via `renderWikiMarkdown`),
  `saveDecision`, `commitSession`. All call `@faerrin/heartwood` core in-process, server-side.

#### 2. Session list + narrative overview (AC-23)
**Files:** `src/routes/index.tsx`, `src/routes/session.$arc.$date.tsx`
- List sessions with status (Unreviewed / Partial / Reviewed). Opening a session shows the
  **narrative summary first** (AC-23), drill into proposals from there.

#### 3. Triage view (AC-1)
**File:** `src/routes/session.$arc.$date.triage.tsx`
- Canon / Uncertain / Noise (noise collapsed with count); promote/discard in one action.

#### 4. Proposal review — rendered in context (AC-2, AC-3, AC-4)
**File:** `src/components/ProposalReview/*`
- **Default Reading view**: the page rendered via `renderWikiMarkdown` with the change
  highlighted in place; **Diff view behind a toggle** (AC-2).
- **Citation on hover** (AC-3): hover a proposed sentence → popover with `(transcript, lineId)`
  + text (local, no LLM); pinnable transcript panel. Unsourced sentence → `unsourced` flag.
- **Edit-in-place** (AC-4): prose editor pre-filled with proposed text + surrounding page prose
  + pinned source lines; saved edit becomes the approved text.
- **Voice warnings (AC-9):** run the §9 *automatable* checks (encyclopedia-opener regex,
  intensifier density, unsourced, "It is…" template) as non-blocking flags.

#### 5. Decisions + jj commit (AC-6, AC-7, AC-8)
**Files:** `src/components/ReviewBar/*`, `src/server/commit.ts`
- Approve / Edit / Reject / Defer per proposal; **nothing written until commit** (AC-6).
- **Commit (AC-7):** write approved prose to `pkg/content/wiki/**` + provenance sidecar, then
  **one batched `jj` revision per session** (D-2) via `Bun.spawn(["jj", ...])` — `--no-pager`,
  `-m` message (salvage the jj-safety rules from the `jj` skill). No PR.
- **Resume (AC-8):** persist per-session decision state; reopening restores deferred/decided.

### Success Criteria

#### Automated
- [ ] Server functions tested with the core stubbed where needed; `commitSession` invokes `jj`
      (asserted via injected spawn) and never raw `git` (AC-7).
- [ ] With no approvals, no wiki file changes and no jj revision exist (AC-6) — asserted.
- [ ] Decision state round-trips: defer → reload → state intact (AC-8) — asserted.
- [ ] Unsourced proposed sentence renders the `unsourced` flag (AC-3/AC-9) — component test.
- [ ] Typecheck + `bun test` pass; `dagger call check` green.
- [ ] **aether build unchanged:** build aether before/after a real commit and diff the file set
      (763 files) + bytes (C6) — scripted check passes.

#### Manual
- [ ] Full loop on a real session: narrative → triage → review rendered-in-context → hover
      citations → edit one proposal in voice → approve several → commit → inspect the single jj
      revision touching `pkg/content/wiki`.
- [ ] Reading view is visually faithful; diff toggle works.
- [ ] Review feels faster than hand-editing (the core product bet).

**Implementation Note:** pause for human confirmation of the end-to-end review+commit loop and
the aether-unchanged check before adding depth.

---

## Phase 3: Depth — conflicts, corrections, creation, page-types  (AC-10–AC-14, AC-21, AC-22, AC-24)

### Overview
Everything that makes the tool correct over a long-running, multi-arc campaign.

### Changes Required

#### 1. Conflict detection — entity-scoped, cross-arc (AC-11, D-9, D-11)
**Files:** `src/pipeline/conflict.ts`, `src/components/ConflictView/*`
- For each new claim, compare only against prior canon sharing a resolved entity (D-11, C1).
  Canon is one shared world; show both statements **with their originating arcs**. Flag
  Conflict, pull to top, offer **Supersede / Coexist / Reject** (no Timeline action, D-3); never
  auto-resolve.

#### 2. Corrections / retractions of committed canon (AC-21)
**Files:** `src/pipeline/assemble.ts` (correct/retract kinds), `src/components/ProposalReview/*`
- Locate the prior sentence via its provenance; show what changes and why; on approval update
  prose + ledger. Page only (D-3).

#### 3. Create-new-page (AC-10)
**File:** `src/components/CreatePage/*`
- Editable title + **folder-tree path picker** (tool proposes, human one-click confirms, D-6);
  opening paragraph (human-authored; voice warnings apply); inbound-link suggestions; flag a
  page nothing links to.

#### 4. Multi-page event grouping (AC-22)
- Group proposals sharing an event so related per-page edits are reviewed together.

#### 5. Wikilink validation (AC-13) + seamless amend (AC-12)
- Validate `[[targets]]` against the wiki index (salvaged `resolveTarget`); flag broken/dup.
  Render amend proposals **inside** the existing paragraph for seam/rhythm judgment.

#### 6. Page-type-aware voice bar (AC-24)
**File:** `src/lib/page-type.ts`
- Detect lore-prose vs deity `::` stat block vs `Timeline.md` HTML vs `<pre>` flavor vs stub
  (per `wiki-nonprose-pages` memory + `pkg/heartwood/CLAUDE.md` templates). Suppress prose
  checks on non-prose types; apply structural checks instead.

#### 7. Noise spot-check (AC-14)
- Expand the collapsed Noise pile; promote a buried fact back to Canon in one action.

### Success Criteria

#### Automated
- [ ] A claim contradicting prior canon (even cross-arc) is flagged Conflict with both arcs and
      offers Supersede/Coexist/Reject, never auto-resolved (AC-11) — tests.
- [ ] Conflict comparison is entity-scoped (no full-canon scan) — asserted via a perf/shape test (D-11).
- [ ] `correct`/`retract` proposals locate the prior sentence via provenance and update ledger
      (AC-21) — tests.
- [ ] Broken/duplicate wikilink targets are flagged (AC-13) — tests.
- [ ] Voice checks are suppressed on a deity stat block / Timeline / `<pre>` page (AC-24) — tests.
- [ ] Typecheck + tests pass; `dagger call check` green; aether build still unchanged.

#### Manual
- [ ] Create a new page end-to-end (path picker, inbound links) and commit it.
- [ ] Resolve a real cross-arc conflict; confirm the page reflects the chosen resolution and
      Timeline.md is untouched (D-3).
- [ ] A multi-page event reviews as one coherent group.

---

## Phase 4: Quality loop + deferred voice assist  (AC-16, AC-17, AC-18, AC-26, D-5)

### Overview
Close the measurement loop and add the optional, never-auto-committed prose assist.

### Changes Required

#### 1. Rejection reasons + quality log (AC-16) and rejection memory tray (AC-26, D-7)
- Tag rejections (`out-of-voice`/`not-canon`/`wrong-page`/`hallucinated`/`already-known`) → log.
  **Auto-suppress identical previously-rejected claims** into a collapsed tray (AC-26, D-7).

#### 2. Slop pre-filters surfaced as warnings (AC-17) + slop-rate metric (non-circular)
- Wire the §9 automatable checks as annotations; compute slop-rate from **reviewer decisions on
  the eval set**, not from the warnings themselves (spec §9 note).

#### 3. Session tally + commit message (AC-18)
- Live approved/edited/rejected/deferred tally; auto-author the jj commit message from it.

#### 4. Deferred voice draft + warn-only critic (D-5)
- Optional in-voice **draft sentence** as an editable starting point + a "voice critic"
  pre-score; **never auto-commits**; human is always the gate.

### Success Criteria

#### Automated
- [ ] Rejecting with a reason logs it; an identical claim next session is suppressed into the
      tray (AC-26) — tests.
- [ ] Slop pre-filters annotate (never auto-reject) (AC-17) — tests.
- [ ] `eval` reports a slop-rate derived from reviewer decisions (not from the warnings).
- [ ] Voice draft, when enabled, never writes without explicit approval (D-5) — tests.
- [ ] Typecheck + tests pass; `dagger call check` green.

#### Manual
- [ ] Over two sessions, the rejection tray and coverage/slop dashboard behave as intended.
- [ ] Voice draft is genuinely a *starting point* — confirm it never bypasses the human gate.

---

## Testing Strategy

- **Unit (`bun:test`, co-located):** mine modality/citation invariants; anchor re-resolution
  (insert/reword/heading-move); entity merge confidence gating; ledger reconcile on hash change;
  provenance sidecar round-trip; conflict entity-scoping; page-type detection; jj invoked (not
  git) via injected spawn. Keep the `completeFn?`/spawn injection pattern — no module mocking.
- **Render validation:** `renderWikiMarkdown` output vs a golden sample of aether-built pages
  (normalized), with an allowed-delta list.
- **App/component tests (vitest + jsdom, mirror strider):** triage actions, citation hover,
  edit-in-place, decision round-trip, unsourced flag.
- **Eval gate:** coverage/false-canon/slop on the labeled set; pipeline PRs must not regress it.
- **Live-site guard:** scripted aether build + 763-file/byte diff before/after a commit (C6).
- **CI:** `dagger call check` (typecheck → astro check → lint → test) stays green throughout.

## Performance Considerations

- **Bounded LLM cost (C1):** windowed transcript input, never whole-wiki; entity-scoped conflict
  retrieval (D-11) keeps conflict cost flat as canon grows; cost logged per run (`log.ts`).
- **Local responsiveness:** transcript citation lookups are local file reads (no LLM) for
  instant hover; render results cacheable per `(wikiPath, contentHash)`.

## Migration Notes

- **Retire old state:** the rewrite uses a new `state/` model; delete old per-stage artifacts
  and `state/submissions/`. Preserve nothing that references PRs.
- **No wiki migration needed for v1** — provenance is additive in a sidecar; existing pages are
  untouched until a session proposes a change. Aether is not modified.
- **Old ledger (`state/processed.json`)** is not migrated; the new `(arc,date)` ledger starts
  fresh (re-ingest is idempotent and cheap).
- **VCS:** all commits via **jj** (`--no-pager`, `-m`); the app shells out to jj, never git
  (root `CLAUDE.md`, `jj` skill).

## References

- Spec: `thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md` (v1.0; AC-1..26, D-1..12, C1..9)
- Constraints memory: `thoughts/shared/memory/heartwood-rewrite-constraints.md`
- Data realities: `thoughts/shared/memory/transcript-arcs-and-naming.md`,
  `thoughts/shared/memory/wiki-nonprose-pages.md`
- Salvage sources: `pkg/heartwood/src/{llm,log,config}.ts`, `src/wiki/*`,
  `src/transcript/{discover,speakers,chunk}.ts`
- App template: `pkg/strider/{package.json,vite.config.ts,tsconfig.json,scripts/editor-server.ts}`
- Render reuse: `pkg/aether/src/lib/{remark-callouts,remark-wikilinks,remark-transcript,directive-handlers}.mjs`, `slug.ts`, `src/styles/{callouts,base}.scss`
- Shared lib: `pkg/content/scripts/lib/folder-index.ts`
