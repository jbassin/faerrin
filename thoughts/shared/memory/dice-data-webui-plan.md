---
name: dice-data-webui-plan
description: planned aether /dice page surfacing mouth's historical SQLite roll data — viz + downloads, snapshot-export architecture, decisions resolved
metadata:
  type: project
---

Plan (not yet built) to surface **mouth's historical dice-roll data** (SQLite `dice` table) as a
web UI in **aether** at `heart.iridi.cc/dice`: view-everything table, CSV/Parquet downloads, and
high-quality visualizations. Plan of record: `thoughts/aether/plans/0001-dice-data-webui.md`;
octo session state in `.claude/session-plan.md` + `.claude/session-intent.md`.

**Architecture (decided):** snapshot export → static artifacts → Solid island. NOT the live eerie
SSE feed ([[eerie-obs-overlay-plan]]). A Bun exporter (`pkg/aether/scripts/export-dice.ts`, like
`pkg/mouth/scripts/migrate-to-sqlite.ts`) reads the *local* `dice.db` (mouth + aether + Caddy share
one host), joins `player_id`→names via `players.toml`, and writes `aether/assets/dice/{summary.json,
rolls.csv, rolls.parquet}`. astro build is additive → aether's 763 wiki files stay byte-identical.

**Key data fact (recon 2026-06-09 via pkg/aether/scripts/recon-dice.ts on pkg/mouth/mouth.db):**
DB is post-cutover — 19,114 rows, the 47.16M `d123456789` junk already dropped. Real campaign data =
**8,791 standard-dice rolls** after filtering. The live outlier is **`d10000`=10,100 rows, all
player_id=3, in a 4-min spam burst on 2025-08-08** → excluded. Clean cut: **`base <= 100 AND
player_id <> 6`** (d1 kept in totals, dropped from luck stats). d20=4,950 rows; span 2023→2026.

**Decisions resolved 2026-06-09:** D1 charting=**ECharts** (follows dark-mode signal); D2 refresh=
**nightly systemd user timer**; D3 privacy=**names yes, no blame graph**; D4 downloads=**CSV+Parquet**
(summary.json = internal viz feed); D5 host=**aether**; D6 exclude **player_id=6 + base=123456789 +
cap absurd bases (~≤1000)**. Remaining settle points: Parquet writer dep + exact base cap.

Execute with `/octo:embrace`. Built on the same single host as [[eerie-obs-overlay-plan]] and mouth
([[speaks-migration]]).
