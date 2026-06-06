---
name: heartwood-rewrite-progress
description: Build status of the heartwood rewrite — Phases 1-4 COMPLETE (core 167 tests, app 53); only the worldbuilder's live browser-commit + aether build-diff remain
metadata:
  type: project
---

The heartwood rewrite (see [[heartwood-rewrite-constraints]], the v1.0 spec, and the plan at
`thoughts/heartwood/plans/2026-06-06-heartwood-rewrite-implementation.md`) is being built
incrementally on `main` (pushed directly). As of **2026-06-06**:

**DONE — the entire headless Phase-1 pipeline (green, 132 tests):**
- Retired the old PR pipeline; rewired config (no `GITHUB_*`).
- `src/anchor` durable sentence anchors (D-1); `src/state` identity + provenance sidecar + ledger
  re-key to `(arc,date)`.
- Pipeline (`src/pipeline/`): **mine → triage → resolve → assemble → conflict**. Each is a
  DI-testable module with an inspection CLI (`scripts/eval|resolve|assemble`).
- Eval harness (`src/eval/`): hand-labeled sessions + LLM-judge scoring. Current: **~81% recall /
  ~61% precision**. 3 reviewed label sets in `pkg/heartwood/eval/labels/`.
- Full pipeline on one session = 112 mined → 98 canon → 40 proposals (19 amend/21 create) +
  narrative + 6 real conflicts vs the live wiki.

**Phase 2 P0 COMPLETE — the interactive review app.** New package `pkg/heartwood-review`
(`@faerrin/heartwood-review`) — standalone local-first **TanStack Start (SSR) + React 19**.
**Stages A–F done & pushed to main (2026-06-06):** SSR scaffold; server-fn I/O; `renderWikiMarkdown()`
**byte-faithful** to aether's build; core persistence (`state/store.ts` SessionArtifact +
`state/review.ts` resumable decisions, node:fs-portable) + `ingest` CLI; server fns
(`listSessions`/`getSession`/`getTranscriptLines`/`saveDecision`); and the full review UI —
session list → narrative (AC-23) → triage (AC-1) → proposal review with edit-in-place (AC-4),
Reading/Diff rendered-in-context (AC-2), citation hover (AC-3), voice warnings (AC-9),
approve/reject/defer persisted, nothing-until-commit (AC-6) + resume (AC-8). A team-mode
code-reviewer pass hardened it (path-traversal guards, LAN bind kept-by-choice, pure
`transcript/filename.ts` to kill a latent Bun import) — see [[heartwood-review-phase2-stage-a-d]]
and [[heartwood-review-app-architecture]]. **Stage F (commit) done:** `commitSession`/`performCommit`
writes approved prose (amend=append paragraph at end of body, the chosen v1 strategy; create=plain
page at a reviewer-chosen path) + provenance sidecar at `pkg/content/.heartwood/provenance/`
(outside wiki/, so aether's build is untouched), then ONE path-scoped **jj** revision (verified to
leave other working changes alone), idempotent via `committedAt`. App: 32 tests; core: 140.
**Phase 3 substantively DONE & pushed** (depth). All shipped with tests:
- **AC-24** page-type-aware voice bar (`src/lib/page-type.ts`; literary checks suppressed on
  deity-statblock/timeline/flavor-pre, stub graduates to prose).
- **AC-13** wikilink validation (broken `[[targets]]` vs allSlugs, aether slug resolution).
- **AC-11** conflict-resolution UI (Supersede/Coexist/Reject, persisted by claimId, `ConflictCard`).
- **AC-10** create-page folder picker (`CreatePagePicker`) + inbound-link suggestions + orphan flag.
- **AC-21** corrections: a Supersede resolution REPLACES the existing statement on commit
  (`applySupersede`); `corrected` tally in the commit message; provenance locates authored
  sentences by normalized match.
- **AC-14** noise spot-check: promote an Uncertain/Noise claim to canon (`promotedClaims`).
- **AC-22** multi-page event grouping by citation overlap (`groupProposalsByEvent`, union-find).
- **AC-12** proper weave amend: the reviewer chooses where prose lands — end (default) / INTO a
  paragraph (one continuous paragraph) / AFTER one — via `WeavePicker`; `applyWeave` (pure) does it
  on commit (locating the target paragraph by text, falling back to end); `renderWovenPreview`
  shows the page with the prose woven in place + highlighted (`<mark class="woven">`).
- Plus a **critical fix**: server-only I/O leaked into the client bundle (hydration crash, latent
  since Stage D) — server-fn modules are now client-safe shells that dynamic-import Node code; the
  rule is load-bearing for any new server fn (see [[heartwood-review-app-architecture]]).

**Phase 3 is COMPLETE (AC-10/11/12/13/14/21/22/24).** Amend default is now a weave with `end` mode
(replaced the old append-only).

**Phase 4 COMPLETE & pushed (2026-06-06)** — quality loop + deferred voice assist. Five steps, each
its own commit + green gate:
- **AC-16** tagged reject reasons → cross-session **rejection store** (`src/state/quality.ts`,
  signature = sha256 of normalized claim text; `bySession` map; node:crypto/node:fs). `saveDecision`
  records on a tagged reject / undoes on un-reject. UI: `ProposalCard` reason picker;
  `lib/rejection-reasons.ts` is the CLIENT-SAFE mirror (don't statically import quality.ts into a
  client component — it pulls node:crypto).
- **AC-26** rejection-memory **tray** (D-7): `getSession` marks a still-pending proposal suppressed
  iff EVERY backing claim's signature was rejected in ANOTHER session (`isSuppressed` excludes the
  current session); session route renders a collapsed "previously rejected" `<details>`.
- **AC-17** non-circular **slop-rate** (`src/eval/slop.ts`): from reviewer accept/reject DECISIONS
  (voice-tagged rejections + approved-rewritten-from-draft), NEVER from the §9 warnings.
- **AC-18** live approved/rejected/deferred/pending tally in the session route.
- **AC-19** **/dashboard** route + `server/dashboard.ts` shell: coverage from eval `--save`
  (now also writes `.score.json`) + live slop + reason tally.
- **D-5** in-voice **draft** assist: core `src/pipeline/draft.ts` (DI completeFn, `MODEL_DRAFT`,
  §9-calibrated anti-slop prompt) → `server/draft.ts` shell → "✨ draft in voice" button fills the
  editor as an EDITABLE starting point; returns text only, never commits (human is the gate). The §9
  voice warnings are the warn-only critic. Needs `ANTHROPIC_API_KEY` in the app env.

Server-fn client-safety re-verified via curl for both new shells (`dashboard.ts`, `draft.ts`):
`createClientRpc`, no static node/core import, no "externalized" error. **Counts:** core 167, app 53.

**ALL acceptance criteria (AC-1..AC-26, D-1..D-12) implemented.** Only remaining: a real end-to-end
**browser commit on a live session + the aether build-diff check** (worldbuilder verification, the
product bet) — not a coding task. Phase 5 (v2 structured-canon graph) is deferred.

**Key facts for continuity:** Bun+TS, strict `noUncheckedIndexedAccess`; LLM only via `complete()`
with DI `completeFn`; jj not git (push main directly); pkg/heartwood/CLAUDE.md is now accurate.
Known headless polish TODOs: resolve over-splits a few entities ("Black Line Badges"), triage
borderline tuning, conflict over-flags borderline cases.
