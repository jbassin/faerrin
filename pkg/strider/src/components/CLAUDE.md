# `src/components/` — local conventions

Components are grouped one-feature-per-directory (`HexMap/`, `MapView/`, `Modal/`, `FactionDetail/`, `Editor/`, `SiteHeader/`, `ClientOnly/`). CSS Modules sit next to the component file they style (`Foo.tsx` + `Foo.module.css`). No barrel files — import from the source.

## `<ClientOnly>` is non-negotiable for Pixi/WebGL

The map renderer is Pixi.js v8. Pixi reaches for `window`, `document`, and WebGL on import, which crashes SSR. The discipline:

- Anything that imports from `pixi.js`, `pixi-filters`, or anything inside `HexMap/` must be reached through a `<ClientOnly>` wrapper with a **lazy** import (so the module never even evaluates server-side).
- New libraries that touch the DOM directly belong here too.
- See `ClientOnly/ClientOnly.tsx` for the wrapper; existing call sites in `MapView/MapView.tsx` and the routes are the pattern to copy.

## `HexMap/` — what each file owns

- `HexMap.tsx` — the React shell. Mounts the Pixi `Application`, owns the canvas ref, and forwards props (current factions, regions, skein state, animation hints) into the scene/animation modules. Should stay thin; visual logic lives in the helpers below.
- `pixiScene.ts` — one-time scene setup: layers, filters, base graphics (hex grid, faction territories, borders). Anything that builds long-lived Pixi objects.
- `animationManager.ts` — consumes a `LayerAnimation` from `src/lib/regions.ts` (region adds, skein connects, faction-flip targets) and stages the visual sequence. This is where playback timing/easing decisions live.
- `animations.ts` — pure animation math/curves (covered by `animations.test.ts`).
- `skeinGeometry.ts` — bowed-curve and comet path math for skein connections (covered by `skeinGeometry.test.ts`).

When changing the skein layer or adding a new `Change` op with a visual effect, expect to touch `animationManager.ts` + possibly `pixiScene.ts`. Don't put new playback state on `HexMap.tsx` itself.

## `MapView/` vs `HexMap/`

- `MapView/` owns **playback state**: timeline cursor (`useTimelinePlayback`), per-layer message reveal (`useTypewriter`), the overlay strip, and the timeline scrubber.
- `HexMap/` is the **renderer**: it takes the current world state + a one-shot animation hint and draws.
- Don't move playback state down into `HexMap` — the split is intentional so the renderer can be driven by any timeline source (live playback, hover-scrub, tests).

## `Modal/`

`Modal.tsx` relies on three things working together — preserve all three when refactoring:

1. `useFocusTrap` from `src/lib/useFocusTrap.ts` (keeps Tab inside the modal)
2. Escape-to-close key handler
3. Backdrop click-to-close (controlled, not a passive bubble — the click must originate on the backdrop, not propagate up from content)

E2E tests in `e2e/faction-flow.spec.ts` cover modal open/close on desktop; if you change the close behavior, run those.

## Misc

- `Editor/` is dev-only — its only consumer is `src/routes/editor.tsx`, which is stripped from production builds via `routeFileIgnorePattern` in `vite.config.ts`. Safe to import dev-only deps here.
- Test files: `*.test.ts` / `*.test.tsx` co-located. Vitest picks them up automatically.
