---
name: heartwood-pr-reuse-map
description: Code-grounded reuse facts for building the NLSpec-0002 GitHub-PR bot — verified signatures + spec-vs-code reconciliations
metadata:
  type: project
---

Reuse map for NLSpec 0002 (Heartwood PR interface — local `gh`-polling bot) at
`thoughts/heartwood/specs/0002-heartwood-pr-interface-spec.md`. Verified against the real code on
2026-06-06 (backend-architect discovery pass). See [[heartwood-review-app-architecture]],
[[heartwood-rewrite-progress]], [[heartwood-rewrite-constraints]].

**Why:** the bot reuses existing modules across two packages; these are the non-obvious facts an
implementation plan needs that aren't derivable without reading every file.

**How to apply:** when implementing the PR bot, trust these but re-verify any named symbol still
exists (code may have moved). Spec assumptions confirmed (✅) / flagged (⚠️) below.

Verified signatures (file:line):
- `draftProse(input, opts): Promise<{draft:string}>` — `pkg/heartwood/src/pipeline/draft.ts:79`.
  ✅ Returns a 1–3 sentence PASSAGE, never a page (D-14). ⚠️ NO `/merge <note>` param — needs an
  `instructions?`/`pageContext` channel for AC-6/D-7.
- Recap = `SessionArtifact.narrative` (persisted by ingest, `store.ts:64`); bot reads it via
  `readSessionArtifact`, does NOT call `assemble()` live.
- Ledger `ReviewStateSchema` — `pkg/heartwood/src/state/review.ts:71`. `conflictResolutions:
  Record<claimId,'accepted'|'rejected'>` ✅ (review.ts:55,77); per-proposal `decisions` keyed by
  proposalId. NO `reviewSurface`/`prNumber`/`branch`/conflict-`deferred` yet — all net-new.
  Pure reducers: `applyConflictResolution` (review.ts:135), `applyDecision` (review.ts:118).
  Any added field MUST be `.default()`/`.optional()` (migration tolerance, review.ts:61).
- `writeFileAtomic` — `state/atomic.ts:10`, unique-tmp+rename (CAS-safe for the lock).
- Provenance sidecar OUTSIDE wiki/ at `PROV_ROOT=pkg/content/.heartwood/provenance` ✅
  (`heartwood-review/src/server/paths.ts:30`, provenance.ts:48).
- `groupProposalsByEvent(proposals, gap=15): string[][]` — `heartwood-review/src/lib/event-groups.ts:38`,
  pure, no deps, reusable as-is.
- `renderWikiMarkdown(md,{srcSlug,allSlugs})` — `heartwood-review/src/render/renderWikiMarkdown.ts:49`,
  emits aether-byte-faithful HTML → use for DEPLOY-PREVIEW only; GitHub sanitizer strips it, so the
  PR-body needs a NET-NEW sanitizer-safe renderer (AC-23, spike-gated). Imports `../../../aether/*.mjs`
  relatively → breaks if called from a different package dir.
- `performCommit(sid, deps=defaultCommitDeps): Promise<CommitResult>` — `heartwood-review/src/server/commit-impl.ts:129`.
  Fully DI'd (`CommitDeps` with `runJj`). Sets `committedAt` (the LOCAL act a remote merge can't do —
  merge-canonizer must reuse this). Already conflict-aware (drops rejected-claim facts).
- `replacePageBody(existing,newBody)` — full-page replace, keeps frontmatter — `heartwood-review/src/lib/page-body.ts:19` ✅ (D-14).

Loud flags:
- ⚠️ The aether build + 763-file diff guard (AC-21) is NOT code — it's a manual worldbuilder step
  today. The merge-canonizer must BUILD it new.
- ⚠️ `@faerrin/heartwood-review` exports nothing as a library (no `exports`/`main`); reuse needs
  deep-imports OR relocating shared helpers (`performCommit`, `event-groups`, `page-body`) toward
  `@faerrin/heartwood` core. Recommended package: NEW `pkg/heartwood-pr` (depends on both; keeps
  core's clean dep direction — review→heartwood, never reverse).
- Bot is a standalone Node/Bun process, NOT a TanStack server fn → it is NOT bound by
  heartwood-review's client-safe-shell rule; it can statically import commit-impl etc.
