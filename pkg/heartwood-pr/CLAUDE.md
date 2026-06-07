# @faerrin/heartwood-pr

The **GitHub-PR review surface** for the heartwood pipeline (NLSpec 0002,
`thoughts/heartwood/specs/0002-heartwood-pr-interface-spec.md`; plan
`thoughts/heartwood/plans/2026-06-06-heartwood-pr-interface-implementation.md`). A local-first
`gh`-polling **bot** (D-1 — *not* a GitHub Action/App) that turns one ingested session into one
**Pull Request**, reviewed async/mobile, sharing **one decision ledger** with the web app
(`@faerrin/heartwood-review`). It is a *peer* surface, not a replacement (N1, D-9).

## The load-bearing principle (read first)

**The PR branch is the draft; merging is the pen-stroke** (spec §6.1). Auto-applied prose and every
re-draft land **only on the session branch** (`hw/<arc>-<date>`); the live wiki (`main`) changes
**only on merge**. This is what lets review happen entirely in GitHub without weakening "keep the
human on the pen". The three original PR-tool failures are retired *by construction*: one
event-grouped PR (burden), prose judged **rendered** not as diffs (wrong surface), recap-led body
(no narrative).

## Architecture: pure core + thin I/O shell

Everything decomposes into **pure machinery** (no GitHub/jj — fully unit-testable) and a **DI'd I/O
shell**. Build + test the pure core with no network; the shell is fake-tested and its *real* run
(actual `gh pr create`, `jj git push`, deploy-preview) is gated on the worldbuilder.

```
src/
  command.ts      ← parse /keep /replace /merge<note> /defer (AC-5/24/25, D-7) + apply→ledger      [pure]
  markers.ts      ← hw:conflict<claimId> / hw:proposal<proposalId> encode/parse + checkbox diff     [pure]
  render-safe.ts  ← markdown → GitHub-sanitizer-safe subset (AC-23, D-10); NOT renderWikiMarkdown    [pure]
  pr-body.ts      ← buildPrBody(artifact, state): header → recap → events → prose + checkboxes        [pure]
  index.ts        ← package surface
  (later) gh.ts / jj.ts / bot.ts / canonizer.ts ← DI'd I/O shell (Phase B, real-run gated)
```

## Reuse (shared, never re-implemented)

- **The ledger** is `@faerrin/heartwood` `src/state/review.ts` — the single source of truth shared
  with the web app. The 0002 deltas (`reviewSurface` lock, `deferredConflicts`, `processedComments`,
  PR linkage) live there as migration-tolerant fields + pure reducers (`acquireSurface` CAS,
  `deferConflict`, `isMergeable`, …). Commands map onto these — never a parallel store.
- **`draftProse`** (`heartwood/src/pipeline/draft.ts`) returns a **passage** (D-14); the bot weaves
  it into the page and writes via **`replacePageBody`** (`heartwood-review/src/lib/page-body.ts`).
- **`groupProposalsByEvent`** (`heartwood-review/src/lib/event-groups.ts`, pure) groups the PR body.
- **`renderWikiMarkdown`** (`heartwood-review`) is **deploy-preview only** — GitHub strips its HTML.
  The PR body uses the net-new **sanitizer-safe** renderer here (`render-safe.ts`).
- **`performCommit`** (`heartwood-review/src/server/commit-impl.ts`, DI'd) is reused by the
  merge-canonizer to set `committedAt`/land the sidecar — a GitHub merge is *remote* and sets
  nothing locally (D-11/AC-21).

## Hard rules

- **jj, not git** (root `CLAUDE.md` + `jj` skill). The session branch is a **jj bookmark** pushed
  with `jj git push` — never raw git (it corrupts jj state). Additive jj **revisions** only; never
  force-push away the reviewer's own branch commits (C3, AC-9).
- **One ledger, one active surface** (D-4): the session lock is mandatory; its validity is *derived
  from PR-open state* so a crashed bot can't wedge a session (D-13, AC-22).
- **Merge is the only path to canon** (C2); no autonomous merge — the human always clicks it.
- **LLM only via the core's `complete()`** (through `draftProse`); every call cost-logged (C5).
- **The bot is a standalone Node/Bun process**, NOT a TanStack server fn — so it is *not* bound by
  heartwood-review's client-safe-shell rule and may statically import `commit-impl` etc.

## Status

**Phase A (pure foundation) in progress.** Ledger delta ✅ (in `@faerrin/heartwood`). The `gh`/jj
I/O shell (Phase B) and the external-dependency boundary (sanitization spike, deploy-preview host,
first real PR — Phase C) are gated on the worldbuilder. gh on this host is **2.4.0** but has
`pr create/comment/edit/list/merge/view` + **`gh api`** (used for reactions, comment ids, PR-body
edits). Remote: `github.com:jbassin/faerrin`.

## Commands

```sh
bun run typecheck   # tsc --noEmit
bun run test        # bun test (co-located *.test.ts, pure, no network)
```
