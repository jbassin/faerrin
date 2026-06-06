## Project

Heartwood is being **rewritten** (see `thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md`,
ratified v1.0, and `thoughts/heartwood/plans/2026-06-06-heartwood-rewrite-implementation.md`). It
turns Pathfinder 2e session transcripts (read from `../content/transcripts/`, the SSOT) into
**reviewed edits on the hand-maintained Obsidian wiki** (`../content/wiki/`, aether canonical;
`Script/` excluded). The old 7-stage PR-shipping pipeline was **retired**; the rewrite ships edits
through a purpose-built **interactive review app** committed via **jj** — **no GitHub PRs**.

The wiki records the **persistent state of the world** (people/places/things/orgs/concepts), **not
session events** — see the `wiki-is-setting-not-session-log` memory for the full criteria
(no events, no game mechanics, no combat, no ephemeral plot/mystery, canonical names, every fact
names an entity).

## Build status (2026-06-06)

**Headless Phase-1 pipeline: COMPLETE and green (132 tests).** The interactive review app
(Phase 2) is **not started** — that's the next work.

```
mine ──▶ triage ──▶ resolve ──▶ assemble ──▶ conflict
cited     canon/     entities    per-page     contradictions
modality  uncertain/ → wiki      proposals    vs the live wiki
facts     noise      pages|new   + narrative
```

Each stage: a pure module under `src/pipeline/` with DI (`completeFn`) for hermetic tests, plus an
inspection CLI under `scripts/`. Current eval: ~81% recall / ~61% precision (LLM-judge scored
against 3 hand-labeled sessions).

## Layout

```
src/
  llm.ts            ← complete() wrapper over @faerrin/llm (Zod tool, temp 0, caching, cost log) [salvaged]
  log.ts, config.ts ← per-run JSONL cost log; frozen env config (ANTHROPIC_API_KEY + MODEL_* keys; no GITHUB_*)
  anchor/anchor.ts  ← durable sentence anchors (content-hash + fuzzy re-anchor) for provenance (D-1)
  state/
    identity.ts     ← SessionId = (arc, date); sessionKey; from transcript filename (C8)
    provenance.ts   ← render-invisible per-page provenance sidecar, re-anchors on read (AC-15)
    atomic.ts       ← writeFileAtomic (tmp → rename)
  transcript/       ← discover (parseFilename → arc/date), speakers, chunk, ledger [salvaged; ledger re-keyed to (arc,date)]
  wiki/             ← loadWikiIndex, frontmatter, wikilinks, index-schema, hash, summarize [salvaged]
  pipeline/
    types.ts        ← Claim (cited + modality + entitySurfaceForms), Modality, isCanonModality
    prompts.ts      ← SETTING_FACT_SYSTEM (canonical mine prompt) + TRIAGE_SYSTEM
    mine.ts         ← transcript → setting-fact Claims (DROP-TEST gate, drops entity-less)
    triage.ts       ← Claims → canon/uncertain/noise (modality hard-rule, conservative)
    resolve.ts      ← entity surface forms → wiki pages (exact + LLM referents), flags merges (AC-20)
    assemble.ts     ← canon claims → per-page proposals (amend|create) + session narrative (AC-23, D-5)
    conflict.ts     ← amend proposals vs existing wiki page → contradictions (AC-11, entity-scoped)
  eval/
    labels.ts       ← EvalLabel schema (hand-labeled canon facts) + reviewed flag
    score.ts        ← coverage/precision/false-canon; injectable Matcher (token default)
    judge.ts        ← LLM-judge Matcher (semantic claim↔fact matching) — trustworthy numbers
    run.ts          ← scoreSession + formatScore
    review.ts       ← interactive eval-label triage loop (DI), used by review-labels CLI
  util/pool.ts      ← bounded-concurrency helper
  cli/              ← hello, cost-report (commander); index.ts registers them
scripts/            ← draft-labels, review-labels, eval, resolve, assemble [--conflict] (inspection CLIs)
eval/labels/        ← 3 hand-reviewed sessions (through-a-song-darkly@2025-08-28=80, fae-and-forest@2025-09-18=47, interred-in-iomenei@2026-02-10=78)
eval/results/       ← gitignored eval reports
state/              ← wiki-index.json (salvaged); runs/ (cost logs, gitignored)
```

## Commands

```sh
bun run typecheck            # tsc --noEmit
bun run test                 # bun test (co-located *.test.ts, DI stubs, no network)
bun run eval <arc> <date>    # mine → judge-scored coverage/precision (+ triage canon-bucket); --token / --no-triage / --save
bun run resolve <arc> <date> # mine → resolve; print entity registry (known/pending, merges to confirm)
bun run assemble <arc> <date> [--conflict]   # full pipeline → proposals + narrative (+ conflicts)
bun run draft-labels <arc> <date>            # bootstrap eval labels via LLM
bun run review-labels <arc> <date>           # interactive approve/edit/deny of label candidates
```
Dates accept `2026-2-10` or `2026-02-10`. LLM calls need `ANTHROPIC_API_KEY` in `.env`.

## Conventions

- **Bun + TypeScript.** `bun test`, `bun run`. Strict tsconfig (extends root `tsconfig.base.json`;
  note `noUncheckedIndexedAccess` is on — guard array access).
- **LLM via `complete()`** (`src/llm.ts`) only — never the SDK directly. Pass a Zod schema; every
  call is cost-logged. Models from `config()` (`MODEL_MINE/TRIAGE/RESOLVE/SUMMARIZE/CONFLICT`).
- **Dependency injection for tests:** every LLM-calling fn takes an optional `completeFn`; tests
  pass a stub (no network). No module mocking.
- **Zod at I/O boundaries;** plain TS interfaces internally. **Atomic writes** (`writeFileAtomic`).
- **jj, not git** (see root `CLAUDE.md` + `jj` skill). Commit when asked; main is pushed directly
  this project.
- **Identity is structural:** session = `(arc, date)` (never the filename stem); citation =
  `(transcript, lineId)`; entity = canonical id + aliases.
- **Cost bounded (C1):** per-chunk/per-page LLM calls, never the whole wiki.

## What's next (Phase 2 — the review app)

A **standalone local-first TanStack Start (SSR) + React** app (new package, e.g.
`pkg/heartwood-review`), mirroring strider's scaffold (declare `@tanstack/router-generator` +
`@eslint/js`; exclude `scripts/` from tsconfig). It consumes the pipeline (mine→…→conflict) via
**server functions** (the chosen I/O model — strider uses a Bun sidecar, but we use
`createServerFn` SSR). Renders wiki pages **aether-faithfully** by reusing aether's remark plugins
(`pkg/aether/src/lib/remark-*.mjs` + `slug.ts`) in a `renderWikiMarkdown()` wrapper (inject
`allSlugs`; copy callout/link CSS). Review loop per the spec: session narrative → triage →
rendered-in-context proposal review → citation-on-hover → edit-in-place → approve/reject/defer →
**provenance sidecar write + one batched jj commit** (AC-1..AC-9, AC-23). See plan §Phase 2 and
spec §6/§11.
