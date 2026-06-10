# Session Intent Contract — dice-roll data webui in aether

**Created:** 2026-06-09
**Workflow:** /octo:plan (team mode — Claude persona subagents; Claude-only repo)

## Job Statement
Surface mouth's historical dice-roll data (SQLite `dice` table) inside aether as a
polished web UI that lets the campaign view all rolls, download the data for local
processing, and explore high-quality data visualizations.

## Captured Answers
- **Goal:** Build the full webui + viz (working page + downloads + visualizations).
- **Clarity:** General direction — wants "view everything + download + nice charts";
  exact charts/metrics not yet specified (open to recommendations).
- **Success:** Working solution + Production-ready (respects aether's byte-identical
  static build / Caddy) + Great-looking (genuinely high-quality) visualizations.
- **Constraints:**
  1. Must fit aether's static build (byte-identical 763-file wiki output, Caddy proxy).
  2. **Backed by mouth's SQLite `dice` DB (historical rows), NOT the live roller SSE feed.**

## Boundaries (derived)
- Do **not** use the eerie live-roll SSE path; this is a batch/snapshot of historical data.
- Do **not** mutate or break aether's existing 763 wiki files (additive only).
- Claude-only: no non-Claude providers; team diversity via octo personas.
- No new always-on public service unless a static/snapshot approach proves insufficient.

## Success Criteria (validation targets)
- New aether page renders rolls + charts; download links produce CSV/JSON.
- `astro build` before/after diff: existing wiki files byte-identical; only additive
  `dice/*` data assets + new page/island chunks appear.
- Exporter excludes the junk `base=123456789` mega-roll (47.16M rows) and joins
  `player_id` → names via `players.toml`.
- Visualizations are high-quality (not generic default charts).

## Plan of Record
`thoughts/aether/plans/0001-dice-data-webui.md`
