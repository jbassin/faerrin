---
name: heartwood-rewrite-progress
description: Build status of the heartwood rewrite — headless Phase-1 pipeline COMPLETE; Phase 2 (review app) is next
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
(replaced the old append-only). **Counts:** core 143 tests, app 53.

**NEXT — Phase 4 (quality loop + deferred voice assist):** AC-16 rejection-reason log, AC-17 slop
pre-filters surfaced (the §9 automatable checks already exist as voice warnings), AC-18 session
tally (commit message already carries it), AC-19 coverage dashboard, AC-26 rejection-memory tray,
and the deferred D-5 in-voice draft + warn-only critic. Also still pending: a real end-to-end
browser commit + aether build-diff (worldbuilder verification).

**Key facts for continuity:** Bun+TS, strict `noUncheckedIndexedAccess`; LLM only via `complete()`
with DI `completeFn`; jj not git (push main directly); pkg/heartwood/CLAUDE.md is now accurate.
Known headless polish TODOs: resolve over-splits a few entities ("Black Line Badges"), triage
borderline tuning, conflict over-flags borderline cases.
