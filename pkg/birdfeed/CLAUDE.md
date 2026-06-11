# CLAUDE.md — `@faerrin/birdfeed`

An **Elgato Stream Deck plugin** that remote-controls `@faerrin/lark` (the Discord music bot) over
lark's HTTP REST API. Navigation: **lark → collection → tag**, with the currently-playing track
highlighted on its key.

**Plan of record:** [`thoughts/birdfeed/plans/0001-birdfeed-streamdeck-plugin.md`](../../thoughts/birdfeed/plans/0001-birdfeed-streamdeck-plugin.md).
**Feasibility research:** [`thoughts/shared/research/2026-06-11-birdfeed-streamdeck-feasibility.md`](../../thoughts/shared/research/2026-06-11-birdfeed-streamdeck-feasibility.md).

## What it is (and the key reframe)

Stream Deck has **no plugin API for folders**, and bundled profiles are **static** (can't be
generated from dynamic library data). So birdfeed is **one workhorse action**
(`com.faerrin.birdfeed.slot`) that the user drops across the deck; a central **controller** assigns
each visible key a **role** from the current nav level + its coordinates and paints it at runtime via
`setImage` (SVG). This is the SDK-sanctioned pattern for data-driven content — more flexible than
folders, and it's what makes the live now-playing highlight possible.

## Architecture (Node, NOT Bun — read this)

The Elgato SDK runtime is **Node 20/24**, so this plugin is a **Node** package even though the repo is
Bun-first (like `mouth`/`gothic`, it lives outside the bun build lanes). It still uses the repo's
bun-driven `typecheck`/`test` gates.

- `src/plugin.ts` — entry: register `Slot`, `streamDeck.connect()`, then `controller.init()`.
- `src/actions/slot.ts` — thin `SingletonAction` shim; forwards willAppear/willDisappear/keyDown.
- `src/controller.ts` — **all SDK-coupled state**: per-device nav, visible-slot registry, lark
  client, now-playing poller (2.5 s — lark has no push), image-diff cache, rendering.
- `src/grid.ts` — **pure**: `layout(nav, device, data) → Role[]` (the heart). Unit-tested.
- `src/nav.ts` — **pure** nav state machine. Unit-tested.
- `src/render/{svg,color}.ts` — **pure** Role→SVG data-URI + color helpers. Unit-tested.
- `src/lark/{client,types}.ts` — REST client (Bearer auth) + mirrored lark shapes.
- `com.faerrin.birdfeed.sdPlugin/` — manifest, `ui/lark.html` (Property Inspector), `imgs/`
  (placeholder icons), `bin/` (rollup output, gitignored).

## Conventions / gotchas

- **Own `tsconfig.json`** extends `@tsconfig/node20` (native TS decorators for `@action`); it does
  **not** extend the repo `tsconfig.base.json` (that targets bundler/ESNext, not Node).
- **No `build` script on purpose.** Bundling is `bun run bundle` (`rollup -c`) so `bun --filter '*'
  build` skips birdfeed — it packages outside the bun lanes. `typecheck` + `test` DO run in the gates.
  Packaging an installable plugin is `bun run package` (`bundle` + `streamdeck pack … --output dist
  --no-update-check --ignore-validation`) → `dist/com.faerrin.birdfeed.streamDeckPlugin`. `--ignore-validation`
  is needed only because the placeholder icons are SVG (the validator wants PNG) — drop it once real
  PNG icons land in `imgs/`.
- **Pure vs. coupled split** mirrors lark: SDK-touching code (`controller`, `slot`, `plugin`) is
  typechecked but not unit-tested (no SDK runtime in CI); everything testable is pure and lives in
  `grid`/`nav`/`render`/`lark client helpers`.
- **Config** (lark origin + `lark_…` key) is entered in the **Property Inspector** and stored in
  **global settings** — shared across every key/device. No env, no `.env`.
- **Voice:** play follows the operator's Discord voice channel (lark default); a `409` shows a
  transient "Join a voice channel first" glyph on the pressed key.

## Local dev / packaging (needs a physical Stream Deck)

```sh
bun run --filter @faerrin/birdfeed bundle     # rollup → com.faerrin.birdfeed.sdPlugin/bin/plugin.js
bunx @elgato/cli link com.faerrin.birdfeed.sdPlugin   # register with the Stream Deck app
bunx @elgato/cli restart com.faerrin.birdfeed
# or: bun run --filter @faerrin/birdfeed watch  (rebuild + hot-restart)
bun run --filter @faerrin/birdfeed package            # → dist/com.faerrin.birdfeed.streamDeckPlugin
```

## CI release (`.github/workflows/birdfeed-release.yml`)

On every push to `main` that touches `pkg/birdfeed/**`, a dedicated workflow builds + packs the
plugin and publishes it as a **GitHub Release** with the `.streamDeckPlugin` attached. It releases
**only when birdfeed actually changed since the last birdfeed release** — gated twice: the `paths:`
trigger, plus a `gate` job that diffs `HEAD` against the most recent `birdfeed-v*` tag. Tags are
`birdfeed-v<manifest.Version>-<shortsha>`. The release job re-runs birdfeed's typecheck + test before
packing, so a broken plugin never ships. (This is the one CI lane that is NOT Dagger — the Elgato CLI
is a Node tool, so it runs directly in the workflow.)

## Not done (needs hardware / host)

- A **live hardware test** (physical deck + running lark + a minted `lark_…` key).
- Real plugin/category/action **icons** (placeholder SVGs shipped in `imgs/`).
- Optional bundled per-device `.streamDeckProfile` files (binary; authored in the SD app) to
  pre-place the slot grid — today the user drops the "Library Slot" action onto keys manually.
