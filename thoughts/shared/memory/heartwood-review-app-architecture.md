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

**⚠️ Server fns must be CLIENT-SAFE shells; Node-IO is dynamic-imported (load-bearing).**
A `createServerFn` module is imported by client components (for the fn reference), so the
TanStack plugin replaces the *handler body* with a `createClientRpc` stub — BUT any
**static top-level import** in that module (and any non-handler export that uses it, e.g. a
helper or `performCommit`) stays in the **client bundle**. node:fs/crypto/child_process get
externalized there and **throw on access** during hydration ("Module node:crypto has been
externalized…"), crashing the page. Rules (enforced in `src/server/`):
- Server-fn modules statically import ONLY: `createServerFn`, **types** (`import type`), and
  **pure** helpers (no node:fs). Path constants + `within` live in `paths.ts` (node:path only,
  client-safe). Pure logic (`parseTranscriptRange`, `assertSessionId`, append/message helpers,
  `detectPageType`, `voice-warnings`, `slugForPath`) is fine to import statically.
- All node:fs / core ledger modules (`state/store|review|provenance|atomic`, `anchor` →
  node:crypto, `child_process`, and `content.ts` which is node:fs) are **dynamic-imported
  inside handlers** (`const { x } = await import("…")`). Heavy server-only impls live in their
  own module (`commit-impl.ts`, `content.ts`) that is never statically imported by a client file.
- Verify after adding a server fn: `curl http://localhost:3001/src/server/<mod>.ts` (Vite-
  transformed) shows `createClientRpc` and NO static `node:`/core-IO import; dev log has no
  "externalized for browser" error when the route loads.

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
