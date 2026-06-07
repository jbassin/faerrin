---
name: heartwood-pr-progress
description: Build status of NLSpec 0002 (Heartwood GitHub-PR interface) — pure local foundation DONE (pkg/heartwood-pr, 44 tests); gh/jj I/O shell + merge-canonizer + deploy-preview still owed
metadata:
  type: project
---

NLSpec 0002 (the GitHub-PR review surface, spec
`thoughts/heartwood/specs/0002-heartwood-pr-interface-spec.md`, plan
`thoughts/heartwood/plans/2026-06-06-heartwood-pr-interface-implementation.md`) is being built via
`/octo:embrace` team-mode. Grounded in [[heartwood-pr-reuse-map]]; extends the 0001 rewrite
([[heartwood-rewrite-progress]]). As of **2026-06-06** the **pure, local foundation (Phase A) is
DONE** — 7 atomic commits on a branch (not yet pushed):

**DONE (green: heartwood-pr 44 tests, heartwood core 178, web app 59; all typecheck clean):**
- **Ledger delta** in the SHARED ledger `@faerrin/heartwood/src/state/review.ts` (NOT a parallel
  store): migration-tolerant fields `reviewSurface` (PrLinkage lock), `deferredConflicts`,
  `processedComments` — all `.default()`/`.optional()` so old review files still parse — plus pure
  reducers `acquireSurface` (CAS: two near-simultaneous opens settle to one winner, AC-7),
  `releaseSurface`, `deferConflict`/`clearDefer`, `isMergeable` (defer blocks merge, D-12),
  `recordProcessedComment`/`isCommentProcessed` (idempotency audit, AC-13). ⚠️ conflict-level
  `deferredConflicts` is DISTINCT from the existing proposal-level `'deferred'` decision — don't
  conflate.
- **New package `pkg/heartwood-pr`** (`@faerrin/heartwood-pr`) — deps on heartwood + heartwood-review;
  pure machinery only, no GitHub/jj yet. Modules:
  - `command.ts` — `parseCommand` (/keep /replace /merge<note> /defer; AC-24 edges: first-only,
    empty-note→replace, URL/`/merged` false-positives rejected) + `applyCommand`→ledger (keep→reject,
    replace/merge→accept, defer; precise `redraft` signal gated on `wasAccepted`, last-write-wins).
  - `markers.ts` — invisible `hw:conflict<claimId>` / `hw:proposal<proposalId>` binding (no reliance
    on GitHub thread position) + `diffCheckboxState` uncheck detection (AC-26).
  - `render-safe.ts` — GitHub-sanitizer-safe prose projection (wikilinks→text, `Key:: val`→bold,
    strips class/style/div/span AND `<script>/<style>/<iframe>` blocks wholesale). `hasStrippedConstructs`
    is the AC-23 unit gate. NOT faithful — the faithful read is the deploy-preview; `renderWikiMarkdown`
    stays preview-only.
  - `pr-body.ts` — `buildPrBody(artifact,state,{drafts,previewUrls})`: header counts → in-voice recap
    → event-grouped (`groupProposalsByEvent` reuse) collapsible sections → per-page pre-checked
    checkbox (ledger-authoritative) + sanitizer-safe prose + preview link; trivial (single-fact amend)
    collapse; conflicted pages annotated. Retires all 3 original PR-tool failures by construction
    (AC-1/2/3).

A team-mode code-reviewer pass caught + fixed one real AC-23 gap (`<style>`/`<iframe>` slipped the
sanitizer gate). Cross-package deep-imports are pure (`event-groups` has zero imports; `store` import
is `import type`) — no aether/Bun/React leak into the Node/Bun package.

**STILL OWED (Phase B/C — the GitHub boundary, paused for the worldbuilder):**
- gh/jj I/O shell (DI'd `GhClient`/`JjClient` over gh 2.4.0 — has `pr create/comment/edit/list/merge`
  + `gh api` for reactions/comment-ids/body-PATCH; remote `github.com:jbassin/faerrin`), the bot poll
  loop (open→poll→redraft via `draftProse`+`replacePageBody`), and the **merge-canonizer** (reuse
  `performCommit` to set `committedAt`/land sidecar; the 763-file aether build guard is NOT code yet,
  must be built — D-11/AC-21).
- **External deps that pause autonomy:** the Phase-0 **sanitization spike** (empirically confirm
  against the live GitHub sanitizer, R7/D-10), the **deploy-preview host** (AC-18), and the first real
  `gh pr create` + `jj git push` on a live session. D-15 merge method (squash vs commit) still TBD.
