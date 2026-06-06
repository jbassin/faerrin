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

**NEXT — Phase 2: the interactive review app** (not started). Standalone local-first **TanStack
Start (SSR) + React** package, server functions calling the pipeline, `renderWikiMarkdown()`
reusing aether's remark plugins, review loop → provenance write + batched **jj** commit
(AC-1..AC-9, AC-23). Also pending: provenance sidecar *writes* on approval, and the two Phase-0a
spikes deferred as needing a browser (render fidelity, server-function I/O).

**Key facts for continuity:** Bun+TS, strict `noUncheckedIndexedAccess`; LLM only via `complete()`
with DI `completeFn`; jj not git (push main directly); pkg/heartwood/CLAUDE.md is now accurate.
Known headless polish TODOs: resolve over-splits a few entities ("Black Line Badges"), triage
borderline tuning, conflict over-flags borderline cases.
