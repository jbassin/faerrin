# `scripts/` — build, dev, and editor tooling

Every script is invoked through a `package.json` script or a Vite plugin — nothing here is imported by the runtime app. These are Bun/Node-side only and may freely use `fs`, `path`, child processes, Playwright, etc.

## `build-content.ts`

The content pipeline. Reads `content/factions/*.md` and `content/layers/*.md`, validates each entry, runs markdown bodies through `remark` + `remark-html`, then emits:

- `src/generated/factions.ts` — `FACTIONS` array + `factionBySlug` lookup
- `src/generated/layers.ts` — `LAYERS` array plus pre-folded `CURRENT_*` snapshots (regions, skein, per-faction hexes, unowned hexes, faction borders, territory borders)
- `src/generated/.gitignore`

Invoked from three places:

1. `bun run generate:content` — direct invocation.
2. `contentWatchPlugin` — Vite plugin runs it on `buildStart` and on any `content/**/*.md` change during `bun dev`.
3. `vitest.global-setup.ts` — runs once if the generated files are missing.

The `parseChange` function is the source of truth for layer schema validation. **Any change to the `Change` union in `src/lib/regions.ts` must be mirrored here**, or layers using the new op will be rejected at build time (or worse, silently mis-parsed).

## `contentWatchPlugin.ts`

The Vite plugin that wires `build-content.ts` into the dev/build lifecycle. Two hooks:

- `buildStart` — re-runs `build-content.ts` so `src/generated/*` exists before module resolution.
- `configureServer` — watches `content/**/*.md`; on change/add/unlink, rebuilds, invalidates the two generated modules in Vite's graph, and sends a `full-reload` over the dev websocket.

Plugin order in `vite.config.ts` matters: this must run before the TanStack router plugin so the generated modules exist when routes resolve.

## `generate-routes.ts`

Stand-alone regeneration of `src/routeTree.gen.ts` (normally produced by the TanStack router Vite plugin). Called by `bun run typecheck` before `tsc --noEmit` so type-checking sees an up-to-date route tree without needing a Vite build.

## `editor-server.ts`

Dev-only Bun HTTP sidecar for the `/editor` route. Run via `bun run editor:server`.

- Binds to `0.0.0.0:3001` (LAN-reachable; the file's top comment is stale on this point — the code below it pins `hostname: "0.0.0.0"`).
- One endpoint: `POST /write-layer` with `{ filename, content }`.
- Validates: filename matches `^\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9-]+\.md$`, content ≤ 64 KB, resolved path stays inside `content/layers/`, file doesn't already exist.
- Echoes the request `Origin` for CORS so the editor works from both `localhost:3000` and the dev server's LAN IP.
- Writes with `flag: "wx"` (exclusive create) — never clobbers.

If you broaden the filename regex or schema, also update `content/layers/CLAUDE.md` so the docs stay aligned.

## `build-og-image.ts`

Renders the Open Graph preview image via Playwright. Runs at the end of `bun run build`, and on its own via `bun run build:og`. Requires the static build to exist (or be running) so Playwright can navigate into it.

## Touching the schema

A schema change typically ripples through three places:

1. The type / fold in `src/lib/regions.ts`.
2. The validator in `build-content.ts` (this directory).
3. Any existing layer markdown that uses the affected shape.

If a visual effect is involved, `src/components/HexMap/animationManager.ts` and the `LayerAnimation` shape in `regions.ts` may also need updating. There's no migration tooling — fix the layer files by hand and let the build error guide you.
