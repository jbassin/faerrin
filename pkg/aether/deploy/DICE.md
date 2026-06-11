# /dice dashboard — deploy / refresh runbook

The `/dice` page (`heart.iridi.cc/dice`) visualizes mouth's historical roll data. The page HTML +
JS are part of the normal aether build; only the **data** under `public/dice/` needs periodic
refreshing from mouth's SQLite. This runbook wires that refresh as a **systemd user timer** on the
same host that runs aether/Caddy + mouth. Plan of record: `thoughts/aether/plans/0001-dice-data-webui.md`.

All host steps are **manual** — nothing here runs automatically until you install the units.

## What runs

`scripts/export-dice.ts` reads `../mouth/mouth.db` **read-only**, joins `player_id → name` via
`../mouth/players.toml`, applies the filter (`base <= 100 AND player_id ∉ {6}`), and writes into
`assets/dice/`:

| artifact        | role                                                    |
| --------------- | ------------------------------------------------------- |
| `summary.json`  | aggregated viz feed (small)                             |
| `rolls.json`    | compact raw rows for the "All rolls" table              |
| `rolls.csv`     | download (timestamp,player,character,base,value,source) |
| `rolls.parquet` | download (columnar, for pandas/polars/DuckDB)           |

`astro build` then copies `assets/dice/` → `public/dice/` (additive — the 763 wiki files are
unchanged). `assets/dice/` is gitignored; the artifacts are regenerated, never committed.

## Manual refresh (any time)

```sh
cd /ruby/data/experiments/faerrin/pkg/aether
bun scripts/export-dice.ts        # → assets/dice/*
bun run build                     # → public/dice/* (Caddy serves it)
```

## Install the nightly timer

```sh
cp deploy/dice-export.service ~/.config/systemd/user/
cp deploy/dice-export.timer   ~/.config/systemd/user/
systemctl --user daemon-reload
loginctl enable-linger "$USER"            # already on if mouth/eerie are installed
systemctl --user enable --now dice-export.timer

# one-off manual run + check:
systemctl --user start dice-export.service
systemctl --user status dice-export.service --no-pager
journalctl --user -u dice-export.service -n 30 --no-pager
systemctl --user list-timers dice-export.timer --no-pager
```

The timer fires at 04:30 nightly (`Persistent=true`, so a missed run catches up on next boot).

## Notes

- **No Caddyfile change needed.** `/dice` and `/dice/*` are already under `heart.iridi.cc`
  (served from `aether/public`). Do not add a new subdomain.
- The export is read-only on `mouth.db`; it is safe to run while the bot is live.
- If the DB path changes, pass `--db /path/to/mouth.db` (and `--players /path/players.toml`) to
  the export step in `dice-export.service`.
- First deploy: run the manual refresh once so `/dice` has data before the first timer fire. Until
  then the page shows a friendly "no data exported yet" notice.
