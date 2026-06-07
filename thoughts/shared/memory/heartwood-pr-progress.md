---
name: heartwood-pr-progress
description: Build status of NLSpec 0002 (Heartwood GitHub-PR interface) — Phase A (pure core) + Phase B (gh/jj DI shell, all 4 bot steps, fake-tested) DONE on main; only real-host wiring (writeBranch/verifyBuild), the sanitizer spike, and the deploy-preview remain (Phase C)
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

**PHASE B DONE (2026-06-06, 7 commits on main, gh/jj DI shell + all 4 bot steps, fake-tested):**
- `draftProse` gained `DraftInput.instructions` (threads `/merge <note>`, AC-6).
- `gh.ts` (`GhClient`+`FakeGh`) over gh 2.4.0 (`gh api` for reactions/comment-ids/body-PATCH);
  `jj.ts` (`JjClient`+`FakeJj`, incl. `changedPaths` = the AC-10 human-edit discriminator). Both real
  impls via execFile are the gated boundary (no live calls in tests).
- `deps.ts` BotDeps seam + in-memory fakes (`FakeLedger`/`FakeArtifacts`/`FakeBranchWriter`); every
  step is `(deps)`-pure and fake-tested.
- Four steps: **openSession** (CAS-lock before any GitHub side-effect, AC-7/27a), **pollOnce**
  (idempotent: commands→ledger w/ 👀→🚀 ack + checkbox-uncheck diff, AC-5/13/14/24/26), **redraftBatch**
  (batch per page, /merge-note-conditioned, skip human-edited via `changedPaths`, auto-uncheck stale
  approvals, AC-6/10/11/12), **canonize** (jj fetch→MERGED→verifyBuild→committedAt+release+cleanup;
  verify-fail BLOCKS, deferred-at-merge flagged; AC-21/D-11/D-15).
- New migration-safe ledger fields: `lastSeenPrBody`, `conflictNotes`, `staleApprovals`; reducers
  `recordConflictNote`/`markStaleApproval`/`markProposalsCommitted`/etc. `pr-body` renders stale as
  unchecked+flagged. `bot.ts` = thin one-shot poll CLI (`bun run bot <open|poll|tick|canonize>`).
- Counts: heartwood-pr **85** tests, core **180**, web app **59** — all green, typecheck clean.

**STILL OWED (Phase C — the host boundary, gated on the worldbuilder; bot.ts THROWS until wired):**
- **writeBranch** real impl: write drafted prose + provenance sidecar to the branch as one additive jj
  revision WITHOUT setting committedAt (the page-write core of `performCommit`, minus committedAt/lock).
- **verifyBuild** real impl: the 763-file aether build + file-set diff guard (AC-21 — NOT code yet).
- **External deps that pause autonomy:** the Phase-0 **sanitization spike** (empirically confirm
  against the live GitHub sanitizer, R7/D-10), the **deploy-preview host** (AC-18), and the first real
  `gh pr create` + `jj git push` on a live session.

**D-15 RESOLVED (2026-06-06): squash merge.** The session branch's many redraft revisions collapse to
**one `main` commit per session** — matching the web app's one-batched-jj-revision model (AC-8) and
giving the simplest jj reconciliation. Canonizer: detect `MERGED` (gh pr view) → `jj git fetch` →
**verify** the fetched main tree = approved prose + provenance sidecar with the other 763 aether files
unchanged (build+diff guard, STILL TO BUILD) → set `committedAt` + `releaseSurface` (local-only acts a
remote merge can't do) → delete local `hw/<arc>-<date>` bookmark + abandon its merged revs. Guardrails:
set repo to **squash-only** merges; bot sets PR title = canonical `commitMessage` subject. Full
rationale + steps in the plan's "D-15 RESOLVED" section.
