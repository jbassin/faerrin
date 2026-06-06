# @faerrin/heartwood-review

The **Phase 2 interactive review app** for the heartwood rewrite — a standalone,
local-first **TanStack Start (SSR) + React 19** app that consumes the headless
`@faerrin/heartwood` pipeline output and lets the worldbuilder review proposed
wiki edits **rendered in aether's voice**, verify them against cited transcript
lines, edit in place, and commit one batched **jj** revision per session. No
GitHub PRs. See `thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md` (§6/§11)
and `thoughts/heartwood/plans/2026-06-06-heartwood-rewrite-implementation.md`
(Phase 2).

## Build status (2026-06-06)

**Stages A–E done. Stage F (commit + provenance write) is next.**
- **A. Scaffold** — TanStack Start SSR + React, mirrors strider (declares
  `@tanstack/router-generator` + `@eslint/js`; extends `tsconfig.base.json`;
  excludes `scripts/`). Runs in **SSR** mode (no prerender) so server functions work.
- **B. Server-fn I/O** — proved read pkg/content + write sidecar + shell `jj` from a
  `createServerFn` (runtime is **Node**; spike route since removed).
- **C. `renderWikiMarkdown`** (`src/render/`) — **byte-faithful** to aether's live
  build (golden-diff on prose / callout / deity stat-block pages).
- **D. Persistence + server fns** — core `state/store.ts` (SessionArtifact) +
  `state/review.ts` (resumable decisions); `scripts/ingest.ts` persists a session.
  `src/server/sessions.ts`: `listSessions`/`getSession`/`getTranscriptLines`/`saveDecision`.
- **E. Review UI** — session list → narrative (AC-23) → triage (AC-1) → proposal review
  with edit-in-place (AC-4), Reading/Diff toggle rendered-in-context (AC-2),
  citation-on-hover (AC-3), voice warnings (AC-9), approve/reject/defer persisted with
  nothing-written-until-commit (AC-6) + resume (AC-8). Components in `src/components/`,
  voice checks in `src/lib/voice-warnings.ts`.

**Next — Stage F:** `commitSession` — write approved authored prose to
`pkg/content/wiki/**` + the provenance sidecar (AC-15), one batched **jj** revision
(AC-7); aether 763-file byte-diff guard (C6). Then the conflict-resolution UI
(Supersede/Coexist/Reject) + create-page path picker are Phase 3.

## Security / hardening (a code-reviewer pass enforced these — keep them)

- **Path containment:** every server fn that reads by a user-supplied path goes through
  `within(root, rel)` (`src/server/content.ts`); session fns validate `arc`/`date` shape
  before building a filename. Don't `join` user input into a path without it.
- **Loopback only:** `vite.config.ts` does NOT set `server.host` — do not expose on the LAN.
- **No Bun globals on the server-fn import path** (see below); `state/identity.ts` imports
  the pure `transcript/filename.ts`, never the Bun-using `discover.ts`.

## Offline dev data

`bun run --filter @faerrin/heartwood-review dev:fixture` writes a realistic SessionArtifact
(no LLM) so the UI works offline. Real data: `… @faerrin/heartwood ingest <arc> <date>`.

## ⚠️ Server functions run under **Node, not Bun**

The Vite SSR runtime is Node (confirmed: `process.version` = node v24 inside a
server fn). **The `Bun` global is `undefined` in server functions.** Therefore:
- All server-side I/O uses `node:*` APIs (`node:fs/promises`, `node:child_process`)
  — never `Bun.file` / `Bun.spawn` / `Bun.write`.
- The core's `Bun.file`-based helpers (`state/provenance.ts`, `state/atomic.ts`,
  `wiki/load.ts`, transcript readers) **cannot be called as-is** from a server fn.
  Stage D makes the core's I/O Node-portable (node:fs works under Bun too) OR reads
  at the app layer with `node:fs` (`src/server/content.ts`) and passes data into the
  core's **pure** functions (mine/triage/resolve/assemble/conflict take strings +
  injected `completeFn`/`readPage`, so those are runtime-agnostic).

## aether-faithful rendering (D-8)

`src/render/renderWikiMarkdown.ts` runs a `unified()` chain that **reuses aether's
live remark plugins** so proposals render exactly as on `heart.iridi.cc`:
`remarkParse → remarkGfm → remarkDirective → remarkCallouts → remarkWikilinksInjected
→ remarkTranscript → remarkSmartypants → remarkRehype(directiveHandlers) →
rehypeHeadingIds → rehypeStringify` (both rehype steps `allowDangerousHtml`).
- **Reuses aether's `.mjs` directly** (relative import into `../../../aether/src/lib/`):
  `remark-callouts`, `remark-transcript`, `directive-handlers` — untyped JS, loose.
- **Wikilinks** are a parameterized port (`remark-wikilinks-injected.ts`) taking an
  **injected `allSlugs`** instead of aether's module-load fs walk (so it can include
  pending new-page slugs). Same `transformLink` "shortest" algorithm.
- **`slug.ts` is VENDORED** (`src/render/vendor/aether-slug.ts`, `@ts-nocheck`) rather
  than deep-imported: it's TypeScript source, so importing it pulls aether's file into
  this strict (`noUncheckedIndexedAccess`) program and reports errors in a file we must
  not edit. `aether-slug.drift.test.ts` fails if the copy diverges from aether's source.
- **smartypants** + **heading ids** match Astro's `smartypants:true` and default
  `rehypeHeadingIds`. `rehype-slug` isn't available offline, so `rehype-heading-ids.ts`
  is a 20-line github-slugger stand-in (same lib → same output).
- **Golden-diff** (`renderWikiMarkdown.test.ts`) compares the rendered article to
  aether's built `<article>` (`pkg/aether/public`, gitignored → test skips when absent).
- CSS: `src/styles/wiki-render.css` is **checkpoint-grade** (readable structure), not
  aether's full themed SCSS cascade. Wire real CSS in Stage E if full parity is wanted.

## Commands

```sh
bun run dev          # vite dev (SSR) on :3001
bun run typecheck    # generate routes → tsc --noEmit
bun run test         # vitest (render fidelity, drift guard)
bun run lint         # eslint
bun run build        # vite build (SSR)
```

## Conventions

- **Bun to launch, Node at runtime in server fns** (see warning above). React 19,
  strict TS + `noUncheckedIndexedAccess`. LLM (when added) only via the core's
  `complete()` with DI. **jj, not git.** Not Caddy-served; not in `sites.caddyfile`.
- Content is read cwd-relative from `../content` (`src/server/content.ts`), matching
  the heartwood core's convention. `Script/` pages are excluded by the core.
