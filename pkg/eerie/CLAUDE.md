# CLAUDE.md — `@faerrin/eerie`

Live **dice-roll OBS overlay**. One `Bun.serve` process does three jobs:

1. **`POST /api/v1/roll`** — authenticated ingest (header `X-Eerie-Token`) from
   `@faerrin/mouth` (the Rust Discord dice bot). Best-effort upstream: mouth logs and
   skips failures, so eerie being down must never break a roll.
2. **`GET /feed`** — **SSE** (`text/event-stream`) hub that fans each roll out to every
   connected OBS Browser Source. One-way; `EventSource` auto-reconnects.
3. **`GET /*`** — serves the built overlay (`dist/`) — a Vite + React 19 + pixi.js
   running **ticker** of recent rolls with crit/fumble flair.

## Stack & conventions

- **Bun everywhere** (`bun test`, `bun run`). Server is plain `Bun.serve` — no framework.
- **Vite + React 19 + pixi.js** overlay; consumes the `@faerrin/gothic` skin (amber/teal).
- TS extends the root **`tsconfig.base.json`** (not the Astro strict config).
- Lean package like `@faerrin/vellum`: participates in `typecheck` / `test` / `build`
  root fan-out. (No eslint/format scripts yet — add later if desired.)

## The mouth → eerie contract

mouth POSTs JSON on every roll. **v0** (today, no Rust change): `{user, value, is_crit,
is_fumble}`. **v1** (richer, later Rust change): adds `expression`, `total`, `ts`, and
eventually `dice[]` / `modifier`. `src/schema.ts` accepts **both** shapes and fills
defaults, so the overlay renders against either. Crit/fumble are **mirrored from mouth's
`RollGoodness`** — eerie does no rule logic.

`mouth/.env`: `FEED_WS_URL=https://eerie.iridi.cc/api/v1/roll` + the `X-Eerie-Token` header.

## Scripts

```sh
bun run dev          # vite dev server (overlay UI, HMR); proxies /feed + /api to the Bun server
bun run dev:server   # bun --hot server.ts (ingest + SSE), default :8787
bun run build        # vite build → dist/ (what OBS loads in prod)
bun run start        # bun server.ts — serves dist/ + ingest + SSE (prod)
bun run typecheck    # tsc --noEmit
bun run test         # bun test
```

## Deploy

New host **`eerie.iridi.cc`** (Caddy block on the host's gitignored `sites.caddyfile`) →
the Bun server port. systemd unit mirrors `pkg/mouth/deploy/mouth.service`. OBS adds a
Browser Source pointing at the eerie URL (transparent, matched canvas size).

Plan of record: `thoughts/eerie/plans/0001-obs-overlay.md`.
