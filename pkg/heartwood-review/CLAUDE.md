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

**Stages A–C done (Phase-0a spikes + scaffold):**
- **A. Scaffold** — TanStack Start SSR + React, mirrors strider (declares
  `@tanstack/router-generator` + `@eslint/js`; extends `tsconfig.base.json`;
  excludes `scripts/`). Runs in **SSR** mode (no prerender) so server functions work.
- **B. Server-fn I/O spike** (`src/server/spike.ts`) — proves read pkg/content +
  write sidecar + shell `jj` from one `createServerFn`.
- **C. `renderWikiMarkdown`** (`src/render/`) — **byte-faithful** to aether's live
  build (golden-diff test passes on prose / callout / deity stat-block pages).

**Next — Stages D–F:** real server functions over the core (`listSessions`,
`getSession`, `getTranscriptLines`, `saveDecision`, `commitSession`) + resumable
review state; the review UI (narrative → triage → rendered-in-context review →
citation hover → edit-in-place → approve/reject/defer); commit + provenance write.

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
