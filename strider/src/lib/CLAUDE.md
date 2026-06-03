# `src/lib/` — local conventions

Pure, framework-free TypeScript. No React imports outside of hook files (`useFocusTrap.ts`, `useIsMobile.ts`). No `fs`, `path`, or other Node-only imports anywhere — these modules are bundled into the client.

## Isomorphic rule

`src/lib/*` is imported by:

- the SSR prerender pass,
- the hydrated client,
- `scripts/build-content.ts` (Node + Bun),
- Vitest unit tests.

If you reach for `process`, `fs`, `path`, `Buffer`, etc. it will work in some of those environments and break in others. Keep these modules deterministic and side-effect-free.

`hexUtils.ts` does run a non-trivial amount of work at module-load time (precomputed assignments + borders). That's allowed because the computation is pure — but be aware it makes this module load-order-sensitive in tests.

## Hex coordinate system (`hexutils.ts`)

- Axial `(q, r)` coordinates, flat-top layout, `HEX_SIZE = 2` pixels per unit. The `2` is a magic number — `pixiScene.ts` in `HexMap/` assumes it and the borders in `CURRENT_FACTION_BORDERS` are baked in those units.
- Grid extent is `GRID_RADIUS = 35` (axial); faction centers sit at `RING_RADIUS = 85` pixels with a `TERRITORY_RADIUS = 38` capture radius.
- **Faction clock layout**: index 19 (the Harlequins) is at the center donut. The other 19 factions ring it — index `i` lives at angle `π/2 − ((i+1) mod 20) · π/10`. Faction index 0 sits one slot clockwise from 12 o'clock.
- The base assignment starts with **only the Harlequins owning territory**. Every other faction is unowned at `t = 0` and gains hexes via `claim` ops in `*-arrives.md` layers. Don't add static base territory to ring factions — that's not how the world model works.
- Adding/removing a faction means recomputing the angle math here and updating `content/factions/` filenames so the order indices stay contiguous.

## `Change` discriminated union (`regions.ts`)

`Change` covers every kind of mutation a layer can express:

- Region ops: `add`, `update`, `remove` (named multi-hex regions, e.g. a building).
- Territory: `claim` (per-hex faction ownership; `faction: null` means explicitly unowned).
- Skein graph: `skein-add`, `skein-update`, `skein-remove`, `skein-connect`, `skein-disconnect`.

Folds are pure: `foldRegions`, `foldFactionOverrides`, `foldSkein`. They throw on invariant violations (adding an existing slug, removing a missing one, self-connect, etc.), which surface as build errors from `scripts/build-content.ts`.

**Adding a new op** is a three-place change:

1. Extend the `Change` union here (`regions.ts`).
2. Extend the matching fold (or add a new one) here.
3. Extend `parseChange` in `scripts/build-content.ts` so the new op validates and survives the YAML → typed-object pass.

If a visual effect is needed, also touch `src/components/HexMap/animationManager.ts` and the `LayerAnimation` shape.

## Generated wrappers

`factions.ts` and `layers.ts` are thin wrappers around `src/generated/{factions,layers}.ts`. The generated files are produced by `scripts/build-content.ts` and gitignored — never hand-edit them. Touch the wrapper API (`getAllFactions`, `getCurrentRegions`, etc.) here; touch the data shape via `build-content.ts`.

## Hooks

`useFocusTrap.ts` and `useIsMobile.ts` are the only React modules in this directory. They're here (rather than `src/components/`) because they're pure logic with no JSX — same dependency profile as the rest of `src/lib/`.

## Tests

Every non-trivial module has a `*.test.ts` next to it. Add tests for new fold logic, hex math, and the editor helpers; they run in CI via `bun run test`.
