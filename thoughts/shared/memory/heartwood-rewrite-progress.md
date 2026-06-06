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

**IN PROGRESS — Phase 2: the interactive review app.** New package `pkg/heartwood-review`
(`@faerrin/heartwood-review`) — standalone local-first **TanStack Start (SSR) + React 19**.
**Stages A–E done & pushed to main (2026-06-06):** SSR scaffold; server-fn I/O; `renderWikiMarkdown()`
**byte-faithful** to aether's build; core persistence (`state/store.ts` SessionArtifact +
`state/review.ts` resumable decisions, node:fs-portable) + `ingest` CLI; server fns
(`listSessions`/`getSession`/`getTranscriptLines`/`saveDecision`); and the full review UI —
session list → narrative (AC-23) → triage (AC-1) → proposal review with edit-in-place (AC-4),
Reading/Diff rendered-in-context (AC-2), citation hover (AC-3), voice warnings (AC-9),
approve/reject/defer persisted, nothing-until-commit (AC-6) + resume (AC-8). A team-mode
code-reviewer pass hardened it (path-traversal guards, loopback bind, pure `transcript/filename.ts`
to kill a latent Bun import) — see [[heartwood-review-phase2-stage-a-d]] and
[[heartwood-review-app-architecture]]. **NEXT — Stage F:** `commitSession` — write approved prose to
`pkg/content/wiki/**` + provenance sidecar (AC-15), one batched **jj** revision (AC-7), aether
763-file byte-diff guard (C6); then Phase 3 (conflict resolution UI, create-page picker, page-types).
Browser checkpoint (full loop) hands to the worldbuilder before/at Stage F.

**Key facts for continuity:** Bun+TS, strict `noUncheckedIndexedAccess`; LLM only via `complete()`
with DI `completeFn`; jj not git (push main directly); pkg/heartwood/CLAUDE.md is now accurate.
Known headless polish TODOs: resolve over-splits a few entities ("Black Line Badges"), triage
borderline tuning, conflict over-flags borderline cases.
