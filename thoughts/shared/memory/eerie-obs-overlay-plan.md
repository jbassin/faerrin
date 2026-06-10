---
name: eerie-obs-overlay-plan
description: planned @faerrin/eerie package — rebuild of the dice-roll OBS overlay fed by mouth
metadata:
  type: project
---

`@faerrin/eerie` (`pkg/eerie`) is a PLANNED, not-yet-built Bun-workspace member: a rebuild
of the decommissioned live dice-roll OBS overlay. Plan lives at
`thoughts/eerie/plans/0001-obs-overlay.md`.

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
