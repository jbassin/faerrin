---
name: birdfeed-streamdeck-plugin
description: birdfeed — Elgato Stream Deck plugin that remote-controls lark; BUILT on main, typecheck+test+bundle green, awaits live hardware test
metadata:
  type: project
---

`@faerrin/birdfeed` (pkg/birdfeed) — an Elgato **Stream Deck plugin** (Node, `@elgato/streamdeck`
v2 SDK + `@elgato/cli`) that remote-controls [[lark-discord-music-bot-spec]] over lark's HTTP REST
API. Navigation **lark → collection → tag**, with the currently-playing track highlighted on its key.

**Status:** BUILT (via `/octo:embrace`, fully autonomous). `bun run typecheck`, `bun test` (24 tests),
and `bun run bundle` (rollup → `bin/plugin.js`) all green; whole workspace stays green. **Only the live
hardware test remains** (needs a physical deck + running lark + a minted `lark_…` key). Plan:
`thoughts/birdfeed/plans/0001-birdfeed-streamdeck-plugin.md`. Feasibility:
`thoughts/shared/research/2026-06-11-birdfeed-streamdeck-feasibility.md`.

**Key architectural facts (non-obvious):**
- Stream Deck has **no plugin API for folders**, and bundled profiles are **static** (can't be
  generated from dynamic library data). So birdfeed is **one workhorse action**
  (`com.faerrin.birdfeed.slot`) the user drops across the grid; a central `controller.ts` assigns each
  visible key a **role** from nav level + coordinates and paints it via `setImage` (SVG data-URI).
- **Node, not Bun** runtime (Elgato SDK needs Node 20/24) — like mouth/gothic it sits **outside the
  bun build lanes**: deliberately **no `build` script** (bundling is `bun run bundle` = `rollup -c`),
  but it KEEPS `typecheck`/`test` so it's in the green gates. Own `tsconfig.json` extends
  `@tsconfig/node20` (native TS decorators), NOT the repo `tsconfig.base.json`.
- Pure logic isolated for tests (`grid.ts` layout, `nav.ts`, `render/{svg,color}.ts`, lark client
  helpers); SDK-coupled glue (`controller`/`slot`/`plugin`) typechecked but not unit-tested.
- Config (lark origin + `lark_…` key) is entered in the **Property Inspector** → global settings.
- Playback **follows the operator's voice channel** (lark default); `409` shows a transient glyph.
  Now-playing is **polled** ~2.5s (lark has no push).
