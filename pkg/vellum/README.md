# @faerrin/vellum — the Diegetic Document Forge

Write `remark`-directive markdown, see it rendered as Pathfinder 2e
statblocks/handouts in the amber/teal 40k-gothic house style, and export a PNG.
It is **purely visual** — it never evaluates a rule or computes a number; it
typesets what you type.

Spec: `thoughts/vellum/specs/2026-06-09-vellum-diegetic-document-forge.md`.

## The flavor

Block documents are `:::kind[Title]{attrs}` … `:::` containers. Six kinds:
`statblock`, `hazard`, `item`, `spell` (mechanical/teal) and `handout`, `edict`
(diegetic/parchment). Inline: `:action[2]` / `:action[reaction]` glyphs,
`:trait[fire]` pills, `:redact[secret]` blackout bars. A `/` in the editor opens
a snippet palette; the toolbar has a template gallery to learn from.

```
:::statblock[Vox-Thrall]{level="Creature 2" traits="undead,mindless"}
Strikes with :action[1], then a litany of static :action[2].
:::
```

Toggle **mechanical | diegetic** in the toolbar; diegetic adds parchment, a
gold-leaf drop-cap, suppressed trait glyphs, and deterministic grime seeded from
the document (the same doc always exports the same image).

## Run it (local)

```sh
bun install
bun run dev                 # editor at localhost:5173
# in another shell — the PNG export service:
bun run build               # produces dist/ (the render service serves it)
bun run render:server       # warm Bun + Playwright on :5252
```

The editor reads `VITE_VELLUM_RENDER_URL` (see `.env.example`). Without the
render service running, **Export** shows an actionable message rather than
failing silently.

## Architecture

- `src/render/` — the **pure, rules-illiterate renderer library** (parser +
  React components). Knows layout, never rules (R-9) or colors (those are
  injected `@faerrin/gothic` tokens). The editor and the render service are two
  consumers of it; the export uses the *same* component path as the preview, so
  the PNG matches what you see.
- `src/app/` — the Vite + React 19 editor SPA (CodeMirror 6, localStorage,
  share links).
- `src/server/` + `scripts/render-server.ts` — the warm render service:
  per-request browser-context isolation, network-egress block (no SSRF),
  caps on size/scale/pixels, a concurrency gate, and rate limiting.

## Deploy

Static editor behind Caddy + a warm render-service sidecar:

1. `VITE_VELLUM_RENDER_URL= bun run build` (empty ⇒ same-origin `/render`).
2. Install `deploy/vellum-render.service.example` as a systemd unit
   (`vellum-render.service`) and enable it.
3. Append `deploy/Caddyfile.example` to the host's gitignored root
   `sites.caddyfile` (it serves `dist/` at `vellum.iridi.cc` and proxies
   `/render` + `/health` to the sidecar), then reload Caddy.

> **Font licensing:** export rasterizes ITC Serif Gothic / Caslon Antique into
> shared PNGs. The project holds a license covering that (spec BLK-1).
