# Session Plan — dice-roll data webui in aether

**Created:** 2026-06-09
**Intent Contract:** `.claude/session-intent.md`
**Plan of record (detailed):** `thoughts/aether/plans/0001-dice-data-webui.md`
**Workflow mode:** team (Claude persona subagents — Claude-only repo; no other providers)

## What You'll End Up With
A new `heart.iridi.cc/dice` page in aether that views all historical rolls from mouth's
SQLite `dice` table, offers CSV/JSON downloads for local processing, and renders
high-quality visualizations (per-player d20 distributions vs. expected-uniform, crit/fumble
leaderboards, luck-over-time, die-usage). Backed by a snapshot exporter that reads the local
`dice.db`, excludes the 47.16M-row junk mega-roll, and joins ids → names via players.toml.

## Architecture (decided)
Snapshot export → static artifacts → Solid island. NOT the eerie live SSE feed.
`mouth dice.db → export-dice.ts → aether/assets/dice/{summary.json,*.csv,rolls.json.gz} →
astro build (additive) → Caddy → /dice page mounts <DiceDashboard/> island`.
Keeps aether's 763 wiki files byte-identical (dice data is additive `public/dice/*`).

## Phase Weights
- Discover: 25% — lock charting lib (Observable Plot vs ECharts) + which stats matter.
- Define: 20% — freeze summary.json contract, page scope, open decisions D2–D6.
- Develop: 35% — exporter+tests, page, island+charts, downloads, refresh trigger.
- Deliver: 20% — byte-identical guard, exporter tests, perf, privacy sign-off, green workspace.

## Decisions — RESOLVED 2026-06-09
- D1 charting → **ECharts** (canvas, follows the dark-mode signal).
- D2 refresh → **nightly systemd user timer** (export + astro build).
- D3 privacy → **player names yes, no blame graph**.
- D4 downloads → **CSV + Parquet** (summary.json is the internal viz feed only).
- D5 host → **aether** (heart.iridi.cc/dice).
- D6 exclusions → drop **player_id=6 + base=123456789 + cap absurd bases**.

## Remaining Develop-time settle points
- Parquet writer dep (hyparquet/parquet-wasm vs DuckDB shell-out).
- Sane base cap (~1000) vs actual distinct bases.
- After Develop: byte-identical wiki output proven? downloads correct & filtered?

## Execution Commands
To execute this plan:
```
/octo:embrace "dice-roll data webui in aether — see thoughts/aether/plans/0001-dice-data-webui.md"
```
Or individual phases: `/octo:discover` → `/octo:define` → `/octo:develop` → `/octo:deliver`.

## Provider Requirements
🔴 Codex CLI: Not installed ✗ (Claude-only repo by design — expected)
🟡 Gemini CLI: Not installed ✗ (expected)
🔵 Claude: Available ✓ — runs all phases via octo persona subagents (team mode)

## Success Criteria
See `.claude/session-intent.md` — working page + downloads + high-quality viz, byte-identical
wiki build, junk mega-roll excluded, ids joined to names.
