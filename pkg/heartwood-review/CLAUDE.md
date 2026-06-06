# @faerrin/heartwood-review

The **interactive review app** for the heartwood rewrite — a standalone, local-first
**TanStack Start (SSR) + React 19** app that consumes the headless `@faerrin/heartwood`
pipeline output and lets the worldbuilder review proposed wiki edits **rendered in aether's
voice**, verify them against cited transcript lines, edit in place, resolve conflicts, and
commit one batched **jj** revision per session. No GitHub PRs. Spec:
`thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md`; plan:
`thoughts/heartwood/plans/2026-06-06-heartwood-rewrite-implementation.md`.

## Build status (2026-06-06)

**Phases 2, 3, and 4 COMPLETE.** (Phase 5 = deferred v2 structured-canon graph.)
- **Phase 2 (P0 loop):** session list → narrative (AC-23) → triage (AC-1) → proposal review
  rendered-in-context with Reading/Diff toggle (AC-2), citation-on-hover (AC-3), edit-in-place
  (AC-4), voice warnings (AC-9), approve/reject/defer with nothing-written-until-commit (AC-6) +
  resume (AC-8); commit writes prose + provenance sidecar (AC-15) as one path-scoped **jj**
  revision (AC-7, D-2), idempotent via `committedAt`.
- **Phase 3 (depth):** AC-11 conflict resolution (Supersede/Coexist/Reject, `ConflictCard`);
  AC-21 corrections (Supersede REPLACES the existing statement via `applySupersede`); AC-10
  create-page folder picker + inbound-link suggestions (`CreatePagePicker`); AC-12 **weave amend**
  (`WeavePicker` + `applyWeave`: end / into-paragraph / after-paragraph, rendered woven + highlighted
  via `renderWovenPreview`); AC-13 wikilink validation; AC-24 page-type-aware voice bar
  (`page-type.ts`); AC-14 noise spot-check (promote, `promotedClaims`); AC-22 multi-page event
  grouping by citation overlap (`event-groups.ts`).
- **Phase 4 (quality loop + voice assist):** AC-16 tagged reject reasons (`ProposalCard` reason
  picker; `lib/rejection-reasons.ts` client-safe mirror) → core rejection store; AC-26 cross-session
  rejection-memory **tray** (`getSession` computes suppression; collapsed "previously rejected");
  AC-17 **non-circular slop-rate** (`@faerrin/heartwood/src/eval/slop.ts` — from reviewer DECISIONS,
  not the §9 warnings); AC-18 live tally; AC-19 **/dashboard** route + `server/dashboard.ts`
  (coverage from eval `--save` + live slop/reason tally); **D-5** deferred in-voice draft +
  warn-only critic (`server/draft.ts` shell → core `pipeline/draft.ts`; "✨ draft in voice" fills
  the editor as an editable starting point — never auto-commits).

**Counts:** app 53 tests, core 167 tests; typecheck + lint green. Server-fn client-safety re-verified
via curl for `dashboard.ts` + `draft.ts`. **Still outstanding (worldbuilder): the real end-to-end
browser commit on a live session + the aether build-diff check** — the product bet.

## Layout

```
src/
  router.tsx, routes/__root.tsx
  routes/index.tsx                 ← session list (status badges) + dashboard/preview links
  routes/session.$arc.$date.tsx    ← the review surface: narrative → conflicts → tabs
                                     (Proposals grouped by event + "previously rejected" tray /
                                     Triage) → live tally → commit bar
  routes/dashboard.tsx             ← coverage (eval harness) + non-circular slop + reason tally (AC-19)
  routes/preview.tsx               ← render-fidelity preview (sample pages)
  server/                          ← CLIENT-SAFE server-fn shells + pure helpers (see split rule)
    paths.ts        ← path constants + within() (node:path only, client-safe)
    content.ts      ← node:fs wiki readers (SERVER-ONLY; dynamic-imported)
    sessions.ts     ← listSessions, getSession, getTranscriptLines, saveDecision,
                      saveConflictResolution, togglePromotion, getWikiFolders,
                      suggestInboundLinks, getPageParagraphs (+ pure parseTranscriptRange, assertSessionId)
    render.ts       ← renderPagePreview, renderMarkdown, renderWovenPreview
    commit.ts       ← commitSession (shell) + pure helpers (appendAuthoredParagraph,
                      applyWeave, applySupersede, newPageContent, commitMessage, normalizeWikiPath)
    commit-impl.ts  ← performCommit (SERVER-ONLY; dynamic-imported by commitSession)
    dashboard.ts    ← getDashboard shell (eval results + live slop/reason tally) (AC-19)
    draft.ts        ← draftProposal shell → core pipeline/draft.ts (D-5; LLM, never commits)
  render/
    renderWikiMarkdown.ts          ← aether-faithful unified() chain
    remark-wikilinks-injected.ts   ← parameterized wikilinks (injected allSlugs) + slugForPath
    rehype-heading-ids.ts          ← github-slugger heading ids (Astro parity)
    vendor/aether-slug.ts          ← VENDORED aether slug.ts (@ts-nocheck) + .drift.test
  lib/
    voice-warnings.ts   ← §9 automatable checks (AC-9) + wikilink validation (AC-13), page-type-aware
    page-type.ts        ← lore/deity-statblock/timeline/flavor-pre/stub (AC-24)
    event-groups.ts     ← group proposals by citation overlap (AC-22)
    rejection-reasons.ts ← CLIENT-SAFE mirror of the core's reject-reason tags (AC-16)
  components/  CitationChip, ProposalCard, TriageView, ConflictCard, CreatePagePicker, WeavePicker
  styles/wiki-render.css   ← checkpoint-grade article CSS (callouts, links, transcript, .woven)
scripts/  generate-routes.ts, dev-fixture.ts
```

## ⚠️ Two load-bearing rules (don't regress these)

1. **Server functions run under Node, not Bun.** The Vite SSR runtime is Node (`process.version`
   = node v24 inside a handler); the `Bun` global is **undefined**. All server-side I/O uses `node:*`
   (never `Bun.file`/`Bun.spawn`). The core's I/O was made node:fs-portable for this.
2. **Server-fn modules must be CLIENT-SAFE shells; Node I/O is dynamic-imported in handlers.**
   `createServerFn` modules are imported by client components, so any **static** top-level import
   (and non-handler exports like `performCommit`) lands in the **client bundle** — and node:fs/crypto/
   child_process get externalized there and **throw on hydration** (this crashed the app; latent
   Stages D–F until fixed). So: static-import only `createServerFn` + types (`import type`) + pure
   helpers; `await import(...)` all node:fs / core-ledger modules inside handlers; heavy server-only
   impls live in their own module (`commit-impl.ts`, `content.ts`). Verify with
   `curl http://localhost:3001/src/server/<mod>.ts` → must show `createClientRpc` and no static
   `node:`/core-IO import, and the dev log must have no "externalized for browser" error on load.
   The architecture memory [[heartwood-review-app-architecture]] has the full rule.

## aether-faithful rendering (D-8)

`src/render/renderWikiMarkdown.ts` reuses aether's live remark plugins so output is **byte-faithful**
to `heart.iridi.cc`: `remarkParse → remarkGfm → remarkDirective → remarkCallouts →
remarkWikilinksInjected → remarkTranscript → remarkSmartypants → remarkRehype(directiveHandlers) →
rehypeHeadingIds → rehypeStringify` (both rehype steps `allowDangerousHtml`).
- Reuses aether's `.mjs` directly (relative import `../../../aether/src/lib/`): callouts, transcript,
  directive-handlers (untyped JS). Wikilinks are a parameterized port with **injected allSlugs**.
- **`slug.ts` is VENDORED** (`vendor/aether-slug.ts`, `@ts-nocheck`) because importing the .ts source
  pulls it into this strict (`noUncheckedIndexedAccess`) program; `aether-slug.drift.test.ts` fails if
  it diverges from aether's source. smartypants + heading-ids match Astro (`rehype-slug` unavailable
  offline → 20-line github-slugger stand-in). Golden-diff test skips when `pkg/aether/public` absent.
- CSS (`wiki-render.css`) is checkpoint-grade, not aether's full SCSS cascade.

## Provenance ledger & the aether byte-stability guard (C6)

Provenance sidecars: `pkg/content/.heartwood/provenance/<wikiPath>.prov.json` — a dot-dir **outside
`wiki/`**, so aether's content walk skips it and committing the ledger never changes aether's build.
A commit only mutates targeted `.md` pages (intended). Before a *real* commit, validate with a build +
file-set diff: only touched/new pages differ; the renderer + other 763 files must not. Don't relocate
provenance into `wiki/`.

## Security / hardening (a code-reviewer pass enforced these — keep them)

- **Path containment:** every server fn that reads by a user path goes through `within(root, rel)`
  (`src/server/paths.ts`); session fns validate `arc`/`date` shape before building a filename.
- **LAN bind is intentional:** `vite.config.ts` sets `server.host=true` (0.0.0.0) so the worldbuilder
  reviews from another LAN device. Safe ONLY because of the path guards + it's never public — don't
  re-fix to loopback, and never relax the guards while this stands.
- **jj via `execFile`** (fixed argv, no shell). `jj commit <paths>` is path-scoped so it never sweeps
  in the worldbuilder's unrelated working changes.

## State model (persisted by the core, read/written by the app)

- `SessionArtifact` (`@faerrin/heartwood/src/state/store.ts`) — narrative, triage buckets, proposals,
  entities, conflicts. Written by `ingest`, read by the app. Under `pkg/heartwood/state/sessions/`.
- `ReviewState` (`@faerrin/heartwood/src/state/review.ts`) — `decisions` (per proposal: decision +
  authoredText + rejectionReason + targetPath + weave + committedAt), `conflictResolutions` (by
  claimId), `promotedClaims`. Under `pkg/heartwood/state/review/`. Both dirs gitignored.
- `RejectionStore` (`@faerrin/heartwood/src/state/quality.ts`) — cross-session rejection memory +
  quality log (AC-16/AC-26): signature-keyed (sha256 of normalized claim text) `bySession` map of
  reason + timestamp. `saveDecision` records on a tagged reject / undoes on un-reject; `getSession`
  uses `isSuppressed` (other-session-only) to fill the tray. Under `pkg/heartwood/state/quality/`
  (gitignored). The dashboard reads it for the reason tally.

## Commands

```sh
bun run dev          # vite dev (SSR) on 0.0.0.0:3001
bun run dev:fixture  # write an offline sample SessionArtifact (no LLM)
bun run typecheck    # generate routes → tsc --noEmit
bun run test         # vitest
bun run lint         # eslint
```
Real review data: `bun run --filter @faerrin/heartwood ingest <arc> <date>` (LLM-backed).

## Conventions

Bun to launch, Node at runtime in server fns. React 19, strict TS + `noUncheckedIndexedAccess`. LLM
only via the core's `complete()` with DI — the only LLM call is `pipeline/draft.ts` (D-5), reached
through the `server/draft.ts` shell; it needs `ANTHROPIC_API_KEY` in the app env and never commits.
**jj, not git** (`--no-pager`, `-m`; push main directly). Not Caddy-served. Content read cwd-relative
from `../content`; `Script/` excluded.
