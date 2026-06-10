# 0001 — Dice-roll data web UI in aether (backed by mouth's SQLite)

**Status:** Plan (not executed). Created 2026-06-09 via `/octo:plan` (team mode, Claude personas).
**Intent contract:** `.claude/session-intent.md`
**Primary deliverable surface:** `pkg/aether` (the `heart.iridi.cc` wiki). Data source: `pkg/mouth` SQLite.

## 1. Goal

A polished, in-aether page that (a) lets the campaign **view all historical dice rolls**,
(b) **downloads** the dataset for local processing, and (c) renders **high-quality data
visualizations** — all backed by mouth's SQLite `dice` table (historical rows), **not** the
live eerie SSE feed.

## 2. The ground truth (verified in-repo)

**Data — `pkg/mouth/crates/discord/migrations/0001_init.sql`, table `dice`:**

| col | type | meaning |
|-----|------|---------|
| `id` | int PK | row id |
| `base` | int | die size (e.g. `20` = d20) |
| `value` | int | result rolled (1..base) |
| `source` | text | default `'discord'` |
| `timestamp` | text | `datetime('now')` ISO string |
| `player_id` | int | who rolled (→ `players.toml`) |
| `blame_id` | int | who was "blamed" for the roll |

Index: `(base, timestamp)`. Per-roll granularity → ideal for distributions, crit/fumble rates,
luck-over-time, per-player breakdowns.

**Critical data-volume fact:** the table contains a junk **`base = 123456789` mega-roll
(47.16M rows of one pathological pool)** — see `scripts/migrate-to-sqlite.ts` / `deploy/CUTOVER.md §6`.
The exporter **must exclude `base = 123456789`** (and likely any absurd `base`). Real meaningful
rows are a tiny fraction of that.

**Identity — `pkg/mouth/players.toml`:** maps `player_id` → `name` (Josh/Jorge/Mike/Noah/Tanner) +
`character` + `class` + `edition`. `name` is the SSOT join key with content. Note `player_id = 6`
is filtered out in the bot's own query (`get_dice_query.sql`) — likely a bot/test id; confirm
whether to exclude it from viz too.

**Consumer — `pkg/aether` (Astro 5 MPA + Solid islands):**
- `astro.config.mjs`: `publicDir: ./assets`, `outDir: ./public`, `build.format: "file"`,
  integrations `solidJs()` + `pagefind()`. **MPA, no ClientRouter** — islands just run on mount.
- Caddy serves `aether/public` for `heart.iridi.cc` (`sites.caddyfile`).
- **Precedent for rich viz already exists:** `src/components/islands/Graph.tsx` (~20KB interactive
  graph) + `TranscriptPlayer.tsx`. A data-viz island is squarely on-pattern.
- Pages live in `src/pages/` (incl. `src/pages/static/`). Dark mode island exists (`Darkmode.tsx`).

**Same-host advantage:** mouth, aether/Caddy, and eerie **all run on one host** (per
`pkg/eerie/deploy/DEPLOY.md`). mouth's SQLite `.db` is therefore a **local file readable at
export time** — no API/network needed. `scripts/migrate-to-sqlite.ts` already proves the
Bun-reads-SQLite pattern.

## 3. Chosen architecture — snapshot export → static artifacts → Solid island

Because the user wants **historical** data and aether is a **static** site on the **same host**
as the DB, the live SSE path (eerie) is wrong here. Use a **batch snapshot**:

```
mouth dice.db ──[export-dice.ts]──> aether/assets/dice/{summary.json, *.csv, rolls.json.gz}
                                          │
                                  astro build (additive; wiki 763 files unchanged)
                                          │
                                   aether/public/dice/*  ── Caddy ── heart.iridi.cc/dice
                                          │
                          dice.astro page mounts <DiceDashboard/> Solid island
                          island fetch('/dice/summary.json') → renders charts + download links
```

**Why this respects byte-identical:** the **wiki** output never depends on dice data, so all 763
existing files stay byte-identical. Dice data lands in **additive** `public/dice/*` files; the new
page + island are **new** code-split chunks (Astro islands are isolated). Validation step in §6
proves nothing existing changed.

**Why decouple the exporter from `astro build`:** the wiki build must stay reproducible and not
bleed runtime DB state. The exporter is a **separate step** that writes data into `assets/dice/`;
the page HTML/JS is byte-stable across exports — only the JSON/CSV data assets differ.

### 3.1 Components to build

1. **Exporter** — `pkg/aether/scripts/export-dice.ts` (Bun + `bun:sqlite`, read-only).
   - Flags: `--db <path>` (mouth's dice.db; on the host: `pkg/mouth/mouth.db`),
     `--out pkg/aether/assets/dice/`, `--base-cap 100`, `--exclude-player 6`,
     `--players <players.toml>`.
   - Joins `player_id` → name via players.toml; applies the D6 filter
     (`base <= 100 AND player_id <> 6`; d1 kept in totals but dropped from luck/crit stats).
   - Emits **pre-aggregated** `summary.json` (small, internal viz feed) + **download** artifacts
     (`rolls.csv` + `rolls.parquet`). **No blame matrix** (D3). See §4 for the contract.
   - Unit-tested (bun test) against a fixture `.db`: junk excluded, aggregations correct,
     player join correct, empty-DB safe.

2. **Page** — `pkg/aether/src/pages/static/dice.astro` (uses an existing layout; route `/dice`
   or `/static/dice` — confirm with wiki nav conventions).

3. **Island(s)** — `pkg/aether/src/components/islands/DiceDashboard.tsx` (Solid):
   `fetch('/dice/summary.json')` on mount → renders the chart views + download buttons +
   a paginated/virtualized "view everything" table.

4. **Refresh trigger** — a **systemd user timer** on the host (mirrors mouth/eerie deploy
   discipline) running `export-dice.ts` + `astro build` on a schedule (e.g. nightly), OR a
   manual deploy step. Documented in a `pkg/aether/... DEPLOY` note. (Decision D2 below.)

## 4. Data contract (database-architect view)

**`summary.json`** (pre-aggregated; target < a few hundred KB):
- `meta`: generated-at, total rolls (post-filter), date range, players[], bases[].
- `perPlayer[]`: `{ name, character, class, totalRolls, byBase: { "20": {count, mean, expectedMean,
  histogram[1..20], crits, fumbles, critRate, fumbleRate, luckDeviation} , ... } }`.
- `timeline[]`: roll counts bucketed (day/week) overall + per player (for luck-over-time).
- `leaderboards`: luckiest/unluckiest (by d20 mean deviation), most crits, most fumbles, most rolls.
- **No `blame[]` section** (D3 — blame matrix intentionally omitted).

**Download artifacts** (D4 — for "local processing"):
- `rolls.csv` — normalized: `timestamp, player_name, character, base, value, source`.
- `rolls.parquet` — same rows, columnar (pandas/polars/DuckDB).
- (`summary.json` is the internal viz feed, not a user download.)
- All artifacts honor the D6 filter (`base<>123456789 AND base<=cap AND player_id<>6`).

**Luck metric:** for a fair die of size `b`, expected mean = `(b+1)/2`. Report observed mean,
deviation, and a normalized z-score per player per base so "lucky/unlucky" is statistically honest
(not just eyeballed) — this is what makes the viz feel high-quality rather than decorative.

## 5. Visualizations (frontend-developer view) — "high quality, not generic"

Proposed views (final set confirmed in Define phase):
- **Overview:** totals, date range, crit/fumble leaderboards, luck leaderboard.
- **d20 distribution per player:** faceted small-multiple histograms with the expected-uniform
  line overlaid (instantly shows who skews high/low).
- **Luck over time:** rolling-mean deviation per player (line chart).
- **Die usage:** breakdown of rolls by base (d20/d6/d100/…) per player.
- **Per-player drill-down + the full "view everything" table** (sortable, virtualized, filterable).
- **Download panel:** CSV / JSON buttons.

**Charting library → ECharts (D1, resolved).** Mount via `<div ref>` + `echarts.init(el, theme)`
inside the Solid island; `dispose()` on cleanup; re-init/`setOption` on the dark-mode signal so the
charts follow `Darkmode.tsx`. Build each chart's `option` object from `summary.json`. Lean on
ECharts' built-in tooltips / legend-toggle / dataZoom for the interactivity that makes it feel
high-quality. Styling matches the wiki palette.

## 6. Validation / deliver (production-ready)

- **Byte-identical guard:** `astro build` on a clean tree, snapshot the file set; apply changes;
  rebuild; diff. **Assert the existing 763 wiki files are byte-identical**; only `dice/*` data
  assets + the new page/island chunks are added. (Repo gotcha mandates this for big aether changes.)
- **Exporter tests:** fixture `.db` → junk base excluded, histograms/means/crit-rates correct,
  player join correct, gzip/CSV well-formed, empty-DB safe.
- **Perf:** `summary.json` small enough for instant load; downloads gzipped; table virtualized.
- **Workspace green:** `bun --filter '*' typecheck` + `bun --filter '*' check` (astro check) pass.
- **Privacy review (D3):** site is public — confirm exposing player display names (already public
  via podcast/wiki) and whether to include the blame graph.

## 7. Decisions — RESOLVED 2026-06-09

- **D1 Charting library → ECharts.** Canvas-based, rich built-in interactivity (tooltips, zoom,
  legend toggles), polished dashboard feel. Declare `echarts` as an aether dep; mount into the
  Solid island via a `<div ref>` + `echarts.init()` on mount, `dispose()` on cleanup, and wire it
  to the existing dark-mode island (init the dark vs light theme from the same signal `Darkmode.tsx`
  uses). Build per-chart `option` objects from `summary.json`.
- **D2 Export trigger → nightly systemd user timer.** Mirrors mouth/eerie deploy discipline:
  a `.service` + `.timer` user unit runs `export-dice.ts` then `astro build` on a daily schedule.
  Data is ~1 day fresh with zero manual effort. Document in the deploy note.
- **D3 Privacy → player names yes, NO blame graph.** Show real display names (Josh/Jorge/… — already
  public via podcast/wiki) on all charts. **Do not** emit or visualize the `blame_id` who-blamed-whom
  matrix. The exporter should simply omit any `blame[]` section from `summary.json`.
- **D4 Download formats → CSV + Parquet** (note: **not** gzipped JSON). CSV for Excel/Sheets/pandas;
  Parquet for heavy local analysis (pandas/polars/DuckDB). `summary.json` still exists but as the
  **internal viz feed**, not a user-facing download. Parquet in a Bun/TS exporter: use a library
  such as `parquet-wasm`/`hyparquet`-writer or shell out to DuckDB if simpler — settle the exact
  writer in Develop (it's the one non-trivial dep).
- **D5 Host → aether** (as requested). `heart.iridi.cc/dice`, static + additive, reusing aether's
  island + dark-mode patterns. (strider noted as a future re-home if it ever wants the explorer.)
- **D6 Exclusions → `WHERE base <= 100 AND player_id <> 6`** (data-confirmed via
  `pkg/aether/scripts/recon-dice.ts` against `pkg/mouth/mouth.db`, 2026-06-09). Findings:
  - DB is **post-cutover**: 19,114 rows, **0** `d123456789` junk (already dropped at migration) —
    keep the `base<>123456789` guard only as a harmless safety belt.
  - **`d10000` = 10,100 rows, ALL by `player_id=3`, in a single 4-minute burst on 2025-08-08** →
    bot/novelty spam, not gameplay. Plus `d987654321` (100), `d1111`, `d1234`. All have `base > 100`.
  - Real polyhedral dice top out at **d100**; there is a clean gap between d100 and d10000, so
    **`base <= 100`** is the natural cut (no legit die is lost).
  - **Real dataset = 8,791 standard-dice rolls** (or ~8,899 incl. oddball d5/d9/d25/d50/etc. that
    are ≤100). Per-player after filter: id2=2,853 · id1=1,948 · id4=1,626 · id3=1,573 · id5=791.
    d20 alone = 4,950 rows. Date span 2023-06-13 → 2026-06-10.
  - `player_id=6` = 15 d20 rolls (2024) → bot/test, excluded.
  - **d1 (62 rows)** is degenerate (always 1): keep in totals but **exclude from luck/crit stats**
    (no variance). Apply the filter identically to viz aggregation AND CSV/Parquet downloads.
  - **Write-side guard added 2026-06-09** (`handler.rs::save_die`): rolls are no longer persisted if
    the pool is >10 dice OR a die's base >100 (the roll still shows in Discord; it just isn't saved).
    So the spam can't recur — the exporter's `base<=100` filter is now belt-and-suspenders, and the
    existing 10,100-row d10000 burst is the only historical pool the read-side filter must scrub.
    NOTE: each die in a pool is one row (no command-grouping column exists), so all counts are
    **"dice rolled," not roll commands** — label viz metrics honestly.

## 8. Phase weighting (for /octo:embrace)

- **Discover ~25%** — lock D1 (charting) + which stats/metrics matter (clarity was "general").
- **Define ~20%** — freeze the `summary.json` contract, page scope, D2–D6.
- **Develop ~35%** — exporter + tests, page, island + charts, download, refresh trigger.
- **Deliver ~20%** — byte-identical guard, exporter tests, perf, privacy sign-off, green workspace.

### Remaining checkpoints (D1–D6 resolved incl. data-confirmed base cap = 100)
- **Parquet writer choice** (the one non-trivial dep): `hyparquet`/`parquet-wasm` writer vs shelling
  out to DuckDB. Settle early in Develop. *(Only remaining unknown.)*
- After **Develop**: "Byte-identical wiki output proven? ECharts bundle acceptable? CSV/Parquet
  downloads correct and filtered (base≤100, id≠6)?"

## 9. Files this will touch (additive)

- `pkg/aether/scripts/export-dice.ts` (new) + test + fixture.
- `pkg/aether/src/pages/static/dice.astro` (new).
- `pkg/aether/src/components/islands/DiceDashboard.tsx` (new) + any chart helpers.
- `pkg/aether/assets/dice/*` (generated data — gitignore the generated artifacts).
- `pkg/aether/package.json` (declare `echarts` + a Parquet writer dep + an `export:dice` script).
- A deploy note (host timer) — alongside aether or in `pkg/aether`.
- **Wiki nav** entry to link the page (the only edit near existing content — verify it doesn't
  perturb the 763-file byte-identical set; if it would, link from a static page instead).
```
