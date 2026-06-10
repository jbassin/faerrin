---
name: eerie-obs-overlay-plan
description: @faerrin/eerie package — the dice-roll OBS overlay fed by mouth (BUILT; awaiting host cutover)
metadata:
  type: project
---

`@faerrin/eerie` (`pkg/eerie`) is a Bun-workspace member: the rebuilt live dice-roll OBS
overlay. **Built and on `main`** (Phases A–F via octo:embrace, 2026-06-09); the only thing
left is the **manual host cutover** (DNS + Caddy `eerie.iridi.cc` block + systemd + OBS
Browser Source) documented in `pkg/eerie/deploy/DEPLOY.md`. Plan/spec at
`thoughts/eerie/plans/0001-obs-overlay.md`.

What shipped: `server.ts` (one Bun.serve: `POST /api/v1/roll` token-auth ingest + `GET /feed`
SSE hub + static `dist/`), a Vite+React 19 ticker (`src/Overlay.tsx`/`RollRow.tsx`), lazy
pixi.js crit/fumble fx (`src/fx/*`), gothic skin. mouth now POSTs the v1 payload
(`handler.rs`) with the `X-Eerie-Token` header. `dice[]`/`modifier` faces remain a deferred
stretch (need Roll traversal).

Locked decisions: **Vite + React 19 + pixi.js** overlay (WebGL crit/fumble fx, gothic skin),
**SSE** transport (one-way, EventSource auto-reconnect), **redesigned versioned payload**
(`POST /api/v1/roll`), new host **`eerie.iridi.cc`**, **running-ticker** UI (last ~6 rolls),
crit/fumble **mirrors mouth's `RollGoodness`**, ingest guarded by **`X-Eerie-Token`** secret.

Architecture: one `Bun.serve` process = ingest POST + SSE hub (`/feed`) + serve built `dist/`.
The feed source is [[speaks-migration]]'s `pkg/mouth` Rust bot, which already fires a
best-effort POST per roll (`handler.rs:562-604`; payload `{user,value,is_crit,is_fumble}`).
Recommended sequencing ships eerie on mouth's existing 4-field payload first, then layers
pixi fx and the richer Rust payload last (isolates the cross-package Rust change).

**Why:** captures the implementation strategy + the rationale behind each tech fork so a
future session can execute without re-deriving the mouth contract.
**How to apply:** read the plan file before implementing; mouth's `.env` `FEED_WS_URL` +
auth header is the only mouth change needed for go-live (a later commit does the rich payload).
