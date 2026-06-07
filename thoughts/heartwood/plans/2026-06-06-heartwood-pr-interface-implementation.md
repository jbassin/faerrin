# Heartwood PR Interface — Implementation Plan

Implements [`thoughts/heartwood/specs/0002-heartwood-pr-interface-spec.md`](../specs/0002-heartwood-pr-interface-spec.md)
(NLSpec 0002, ratified v1.0). Grounded in the discovery reuse map
([[heartwood-pr-reuse-map]]). Built via `/octo:embrace` team-mode (Claude personas: backend-architect,
devops/contrarian discovery; code-reviewer deliver).

## Strategy: build the local, testable core first; pause at the GitHub boundary

Everything the bot does decomposes into **pure/local machinery** (ledger, command parsing, PR-body
generation, markers, sanitizer-safe rendering, re-draft weaving) and a thin **gh/jj I/O shell**
(open PR, poll comments/reactions, push bookmark, detect merge). The pure machinery is fully
unit-testable with no GitHub. The I/O shell is built behind a DI'd interface and unit-tested against
a fake; **actually running it** (real `gh pr create`, `jj git push`, deploy-preview host) is the
autonomy boundary — outward-facing and host-dependent, so it pauses for the worldbuilder.

### Verified discovery facts (re-confirm symbols before use)
- `draftProse(input, opts): Promise<{draft}>` returns a **passage** (D-14 ✅); `DraftInput` already
  has `pageContext` but **no `/merge <note>` channel** — add `instructions?` for AC-6.
- Ledger `ReviewStateSchema` (`heartwood/src/state/review.ts`): `conflictResolutions:
  Record<claimId,'accepted'|'rejected'>` ✅, `decisions` per proposalId. No lock/PR/defer fields yet.
  All new fields must be `.default()/.optional()` (migration tolerance).
- ⚠️ Proposal-level `'deferred'` **decision** already exists (web app) — the new **conflict**-level
  defer (D-12) is a **distinct** `deferredConflicts: claimId[]` set; don't overload the decision enum.
- `groupProposalsByEvent(proposals, gap=15): string[][]` pure, reuse as-is.
- `renderWikiMarkdown` emits aether HTML → **deploy-preview only** (GitHub strips it); PR body needs
  a **net-new sanitizer-safe** renderer (AC-23).
- `performCommit`/`replacePageBody` (heartwood-review) DI'd; merge-canonizer reuses them. ⚠️ the
  763-file aether build guard is **not code yet** — the canonizer must add it.
- gh is **2.4.0** but has `pr create/comment/edit/list/merge/view` + **`gh api`** → sufficient
  (use `gh api` for reactions, comment ids, PR-body PATCH). Remote: `github.com:jbassin/faerrin`.

## Phase A — Local foundation (this session, committed step by step)

1. **Ledger delta** (`heartwood/src/state/review.ts`): add `reviewSurface:'web'|'pr'|null`,
   `prNumber`, `branch`, `lastBotBookmarkTarget`, `deferredConflicts: string[]`,
   `processedComments: Record<commentId,resolution>` — all defaulted. Pure reducers:
   `acquireSurface` (CAS on null/expired), `releaseSurface`, `deferConflict`, `clearDefer`,
   `recordProcessedComment`, `isCommentProcessed`, `isMergeable` (no deferredConflicts). Tests.
   *(AC-7, AC-22, AC-24, D-12, D-13.)*
2. **Package scaffold** `pkg/heartwood-pr` (@faerrin/heartwood-pr; deps heartwood + heartwood-review;
   tsconfig extends base; CLAUDE.md; index).
3. **Command parser + engine** (`src/command.ts`): `parseCommand(body)` → `/keep /replace
   /merge<note> /defer`; AC-24 edges (first-only, empty-note→replace, non-command→null);
   `applyCommand(state, claimId, parsed)` → ledger mutation. Tests. *(AC-5, AC-24, AC-25, D-7.)*
4. **Markers + checkbox diff** (`src/markers.ts`): `hw:conflict<claimId>`, `hw:proposal<proposalId>`
   encode/parse; `diffCheckboxState(old,new)` → unchecked proposalIds. Tests. *(AC-13, AC-26.)*
5. **Sanitizer-safe renderer** (`src/render-safe.ts`): markdown → GitHub-allowed subset
   (GFM blockquote/`<details>`/bold; no div/style/pre). Round-trip test asserts raw HTML stripped.
   *(AC-23, D-10.)*
6. **PR body generator** (`src/pr-body.ts`): pure `buildPrBody(artifact, state)` → header(counts) →
   recap → event-grouped `<details>` → per-page safe prose + pre-checked checkboxes w/ markers;
   trivial-edit collapse. Tests. *(AC-1, AC-2, AC-3, AC-16, AC-26.)*

## Phase B — gh/jj I/O shell (DI'd; built + fake-tested, real-run gated on user)
- `GhClient` interface (`prCreate/prView/prComment/listComments/addReaction/editBody/prState`) over
  `gh`/`gh api` via `execFile` (no shell). `JjClient` (`bookmarkSet/gitPush/gitFetch/log`).
- Bot orchestrator: open (bookmark→push→pr create→body), poll (comments→commands→ledger→ack 👀✅;
  body edits→checkbox unchecks), redraft (batch `draftProse`→`replacePageBody`→additive push;
  skip human-edited pages via `lastBotBookmarkTarget`; auto-uncheck invalidated). *(AC-4..14.)*
- **Merge canonizer**: `gh pr view --json state` / `jj git fetch` detects merge → reuse
  `performCommit` path to set `committedAt`, verify sidecar landed, release lock, **new** aether
  build + 763-file diff guard. *(AC-21, D-11; merge method resolved below.)*

## D-15 RESOLVED — squash merge + fetch-verify-abandon reconciliation

The spec left D-15 (merge method + post-merge jj reconciliation) to this plan. **Decision: squash
merge.** The session branch accumulates many jj revisions during review (open draft + each additive
re-draft); how those collapse onto `main` at merge is the whole question.

**Why squash (not merge-commit / rebase):**
1. **It is the web-app model.** The web app lands exactly **one batched jj revision per session**
   (0001 AC-7). Squash produces exactly **one `main` commit per session** — matching AC-8's
   "byte-identical to what a web-app commit would have produced" at the *history* level, not just the
   tree. A merge-commit (two parents) or rebase would smear `main` with the intermediate LLM-redraft
   churn the web-app path never creates — noise in a hand-curated wiki's history.
2. **Cleanest jj reconciliation.** A squash commit is an *independent* commit (it doesn't preserve
   the branch parentage), so the canonizer just `jj git fetch`es it onto `main`, verifies content,
   then abandons the now-redundant local branch revisions. No two-parent merge to import, no
   SHA-churning replay.
3. **Content parity is automatic.** The branch was written via the SAME `performCommit`/
   `replacePageBody` path the web app uses (D-1 reuse), and the provenance sidecar travels in the
   branch (outside `wiki/`, D-8). So the squashed tree = approved prose + sidecar = the web-app tree.

**Canonizer reconciliation steps (post-merge, AC-21/D-11):**
1. **Detect** the merge by PR state (`gh pr view --json state,mergedAt` → `MERGED`) — key off
   *merged state*, NOT the method, for safety.
2. `jj git fetch` → `main` advances to GitHub's squash commit; the remote session branch is deleted
   (GitHub default on merge).
3. **Verify** (the byte-stability gate, *still to be built as code*): the fetched `main` tree carries
   the approved page bodies + provenance sidecar exactly as `performCommit` would write them, and the
   other **763** aether build files are unchanged (build + file-set diff). On mismatch → **do NOT
   canonize**; flag for manual review (never silently bless a divergent merge).
4. **Local-only acts** a remote merge can't do (C10): set `committedAt` in the shared ledger,
   `releaseSurface` (release the lock), record canonization.
5. **Clean jj:** delete the local `hw/<arc>-<date>` bookmark + abandon its merged revisions (content
   now lives in `main`'s squash commit); rebase the bot's working copy onto the new `main`.

**Two enforcement guardrails for the worldbuilder (repo config, not code):**
- Set the GitHub repo to **allow squash merging only** (disable merge-commit/rebase buttons) so the
  human can't accidentally pick a history-smearing method — "the human always clicks merge" (C2), so
  constrain the button, not the click.
- The bot sets the **PR title = the canonical commit-message subject** (`commitMessage` helper) so the
  squash commit's default subject matches a web-app commit's, completing message-level parity.
- *Safety net:* if a non-squash merge happens anyway, the canonizer still reconciles off `MERGED`
  state and the content guard still protects byte-stability — it just warns that history diverged.

## Phase C — External-dependency boundary (worldbuilder)
- **Sanitization spike** (R7/D-10): empirically confirm the safe representation survives GitHub's
  sanitizer on a real PR body (or `gh api markdown`). Phase-0 gate before shipping the surface.
- **Deploy-preview host** (AC-18): per-branch aether build + preview host — needs infra the
  worldbuilder provides.
- First real `gh pr create` + `jj git push` on a live session.

## Acceptance-criteria coverage map (where each AC lands)
P0: AC-1/2/3 → §6 pr-body; AC-4 → bot push (branch-only); AC-5 → command engine; AC-6 → redraft;
AC-7 → ledger lock; AC-8/21 → merge canonizer; AC-9 → jj client; AC-23 → render-safe.
P1: AC-10..17/24..27 → bot poll/redraft/lifecycle + ledger. P2: AC-18/19/20 → deploy-preview/labels/re-ingest.
