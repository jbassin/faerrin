---
date: 2026-06-11
package: "@faerrin/birdfeed (pkg/birdfeed)"
status: in-progress (built autonomously via /octo:embrace)
research: thoughts/shared/research/2026-06-11-birdfeed-streamdeck-feasibility.md
---

# birdfeed — implementation plan

A Node Stream Deck plugin (Elgato `@elgato/streamdeck` v2 + `@elgato/cli`) that remote-controls
`@faerrin/lark` over its HTTP REST API. Navigation: **lark → collection → tag**, with the
currently-playing track highlighted on its key.

## Decisions (resolved)
- **Autonomy:** fully autonomous build.
- **Connection config:** Property Inspector (global settings) — paste lark origin + `lark_…` key.
- **Voice channel:** follow the operator (lark default); show an error glyph on the key on `409`.
- **Device target:** Stream Deck XL (8×4) first, but layout is computed from `device.size` so it
  adapts to any deck (Standard 5×3, etc.).
- **Tags per collection (research OQ-3):** when entering a collection, fetch its tracks **once**
  (`GET /tracks?collection=X&limit=500`), derive the **colored** tags actually present, and filter
  tracks client-side per tag — no per-tag round-trips, and the tag grid only shows real tags.
- **Navigation substrate (research §2):** NOT Stream Deck folders/profiles (can't be dynamic). One
  workhorse action `com.faerrin.birdfeed.slot` placed across the grid; a central controller assigns
  each visible key a **role** from the current nav level + its coordinates and paints it at runtime.

## Architecture
```
Stream Deck app ──WS──> birdfeed (Node plugin) ──HTTPS Bearer──> lark /api/v1
  src/plugin.ts            entry: register Slot action, connect
  src/actions/slot.ts      SingletonAction → forwards events to the controller
  src/controller.ts        per-device nav state, slot registry, render diffing, now-playing poller
  src/grid.ts              layout(nav, device, data) → Role[] (the heart; pure + unit-tested)
  src/nav.ts               NavLevel state machine (pure + unit-tested)
  src/render/svg.ts        Role → data:image/svg+xml,… (pure + unit-tested)
  src/render/color.ts      palette + contrast + hex helpers (pure + unit-tested)
  src/lark/client.ts       LarkClient (fetch wrapper, Bearer auth, LarkError on !ok)
  src/lark/types.ts        mirrored shapes (Collection/Tag/Track/NowPlaying)
  com.faerrin.birdfeed.sdPlugin/  manifest + bin/ (built) + imgs/ + ui/lark.html (PI)
```

### Roles & layout (src/grid.ts)
`layout(nav, {columns,rows}, data)` returns a row-major `Role[]` of length `columns*rows`:
- **root:** every cell = a collection; last two cells become prev/next pagers on overflow.
- **collection:** cell 0 = Back; the rest = colored-tag swatches (paged).
- **tag:** the **rightmost column** is the nav column — top cell = Back, the rest = sibling-tag
  quick-jump swatches (active tag highlighted, truncated to fit). The **left region** (cols <
  last) = track keys, paginated, with the playing track highlighted.

### Now-playing (poll, ~2.5s — lark has no push)
Controller polls `GET /api/v1/playback/now`; caches `current.trackId` + status; re-renders only
**track** keys whose rendered image changed (image diff cache keyed by action context id). Poller
starts on first `willAppear` (when configured) and stops on last `willDisappear`.

## Build / CI fit
- Own `tsconfig.json` extending `@tsconfig/node20` (Node-targeted, native TS decorators) — does NOT
  extend the repo `tsconfig.base.json`.
- Scripts: `typecheck` (`tsc --noEmit`) and `test` (`bun test`) → **stay in the green gates**.
  Bundling is `bundle` (`rollup -c`), **not** `build`, so `bun --filter '*' build` skips it — birdfeed
  packages outside the bun lanes (like `mouth`/`gothic`). Packaging: `bun run bundle` → `streamdeck pack`.
- Pure modules (`grid`, `nav`, `render/*`, lark query builder) are unit-tested with `bun:test`; the
  SDK-coupled glue (`slot`, `controller`, `plugin`) is typechecked but not unit-tested (no SDK runtime
  in CI), mirroring lark keeping Discord behind an integration boundary.

## Out of scope / left for the host
- Real plugin/category/action icons (placeholder SVGs shipped).
- A live hardware test (needs a physical deck + a running lark + a minted `lark_…` key).
- Bundled per-device `.streamDeckProfile` files (binary, must be authored in the SD app) — the user
  drops the "birdfeed" slot action across the grid instead.

---

## v2 — tag-page rework (2026-06-11, user feedback)

Reworked the tag page after the first hardware-less build. Key changes:

- **Dropped the intermediate collection→tag-grid level.** Nav is now just **root (collections) → tag
  page**. Pressing a collection opens its tag page directly at the default tag **`calm`**.
- **Fixed six-button tag taxonomy** (`src/tags.ts`): `explore/stealth/battle/calm/dungeon` resolve to
  real lark tags **by name** (case-insensitive → id + color); **`other` = catch-all** (collection
  tracks with none of the five). Unresolved named tags render **dim** + no-op. Colors come from lark.
- **Fixed tag-page layout** (XL 8×4, right-edge-relative so it degrades on smaller decks):
  - `(0,0)` reserved/blank.
  - col C-1: `Back, explore, stealth, other`.
  - col C-2: `play/pause, battle, calm, dungeon`.
  - col C-3: `page info (p/total), next, prev, empty`.
  - left region: track tiles, **column-major** (top→bottom, then left→right), skipping `(0,0)`,
    paginated via the page column (capacity 19 on XL).
- **Track tiles**: background = the active tag's color; **larger title font**; pressing a tile plays
  it, or **toggles pause/resume** if it's already the current track. The dedicated `play/pause` key
  toggles global playback.
- Tests in `test/{nav,grid,svg}.test.ts` rewritten for the new model; 35 pass.

Still open: real PNG icons; live hardware test. A transport row (skip/next/prev/stop) was discussed
but not added.
