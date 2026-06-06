---
name: heartwood-review-app-architecture
description: Non-obvious architecture facts for the pkg/heartwood-review app — Node-not-Bun SSR runtime, aether render reuse, TanStack server-fn API
metadata:
  type: project
---

`pkg/heartwood-review` (`@faerrin/heartwood-review`) is the Phase-2 review app for
the heartwood rewrite ([[heartwood-rewrite-progress]]). TanStack Start **SSR** +
React 19, mirrors strider's scaffold but **no prerender** (server functions need
SSR). Local-first dev tool; **not** Caddy-served. Built 2026-06-06 (Stages A–C).

**⚠️ Server functions run under Node, NOT Bun.** The Vite SSR runtime is Node
(`process.version` = node v24 inside a `createServerFn` handler); the **`Bun`
global is `undefined`** there. Consequences:
- All server-side I/O uses `node:*` (`node:fs/promises`, `node:child_process`) —
  never `Bun.file`/`Bun.spawn`/`Bun.write`.
- The heartwood **core's `Bun.file`-based helpers** (`state/provenance.ts`,
  `state/atomic.ts`, `wiki/load.ts`, transcript readers) **cannot be called as-is**
  from a server fn. The core's **pure** stage fns (mine/triage/resolve/assemble/
  conflict — take strings + injected `completeFn`/`readPage`) ARE runtime-agnostic.
  Stage D must either make core I/O node:fs-portable (works under Bun too) or read
  at the app layer (`src/server/content.ts`) and feed the pure fns.

**TanStack server-fn API (v1.168):** `createServerFn({method}).inputValidator((d:
T) => d).handler(async ({ data }) => …)` — the method is **`inputValidator`** (not
`validator`). Call it as `fn({ data: T })`. A route with `validateSearch` that
defaults a param 307-redirects `/x` → `/x?param=…` (use `curl -L`).

**aether-faithful render (`src/render/renderWikiMarkdown.ts`):** reuses aether's
live `.mjs` plugins via relative import into `../../../aether/src/lib/`
(remark-callouts/transcript/directive-handlers — untyped JS, loose). Wikilinks are
a parameterized port with **injected `allSlugs`** (not aether's fs walk). `slug.ts`
is **VENDORED** (`src/render/vendor/aether-slug.ts`, `@ts-nocheck`) because importing
the .ts source pulls it into this strict (`noUncheckedIndexedAccess`) program and
errors in a file we must not edit; a drift-guard test keeps the copy == aether's.
Chain adds **smartypants** + **github-slugger heading ids** to match Astro's
`smartypants:true` + default `rehypeHeadingIds` (rehype-slug unavailable offline).
Result is **byte-identical** to aether's built `<article>` (golden-diff test on
prose/callout/deity-statblock; goldens live in gitignored `pkg/aether/public`, so
the test skips when no local `astro build` exists). See [[wiki-nonprose-pages]].

**Why:** Phase-0a spikes done as Stages A–C of Phase 2 (needed a browser; verified
headlessly via curl + golden tests). **How to apply:** never use Bun globals in
server fns; build Stage D server fns on `node:fs` + the core's pure stage fns;
keep the vendored slug in sync via its drift test.
