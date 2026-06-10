# speaks — deploy / cutover runbook

Take the vendored Discord bot live as a **systemd user service** on the same host that runs
aether/Caddy, isolated so it can never threaten `heart.iridi.cc`. Mirrors `wretch`'s deploy
discipline (bare systemd user unit, no container; secrets via `EnvironmentFile`). All host steps
are **manual** — nothing here runs automatically.

> Staged migration — see `thoughts/speaks/plans/0001-speaks-migration-spec.md`. This runbook
> grows per phase. Phase 1 = vendor + portability (you can run the bot from the repo now).

## 0. Prerequisites (host)

- A Rust **nightly** toolchain (the `roller` crate uses a nightly feature), OR use the musl
  Docker image (below). `cargo`, `clippy`, `sqlx-cli` already present on the dev host.
- **Postgres** reachable at `DATABASE_URL` — for Phases 1–3 only. Point at the **existing**
  bot database (or a local snapshot); do **not** stand up a fresh PG daemon for this — by Phase 4
  the datastore becomes a plain SQLite file (R1.6).
- A secrets file at `~/.config/faerrin/mouth.env`, mode `0600`, **not** in git. Use
  `pkg/mouth/.env.example` as the template.

## 1. ⚠️ Rotate the leaked webhook (DO THIS FIRST)

The dice-feed webhook token was hardcoded in the bot's source and is in git history — treat it
as **compromised**. In Discord: delete/regenerate that channel webhook, then put the **new** URL
in `~/.config/faerrin/mouth.env` as `DICE_FEED_URL=`. The code no longer contains any token.

## 2. Build the binary

```sh
cd /ruby/data/experiments/faerrin/pkg/mouth

# Option A — host build (fastest for iterating):
SQLX_OFFLINE=true cargo build --release           # → target/release/discord

# Option B — reproducible musl build (what CI/deploy uses):
#   built in the Dagger Rust lane, or via the Dockerfile (clux/muslrust + cargo-chef).
#   dagger call rust-build --source=.    # → musl binary
```

Point the unit's `ExecStart=` at whichever binary you built (the template assumes
`target/release/discord`).

## 3. Validate before going live

```sh
cd /ruby/data/experiments/faerrin

# Rust lane (fmt → clippy → test), same as CI:
dagger call rust-check --source=.

# Smoke-check against a TEST Discord guild (no gateway-integration harness exists yet):
#   - a dice roll posts a result + the dice feed
#   - a saved macro `name(args)` round-trips
#   - the NPC-voice `speak` path works
#   - confirm the axum control plane is bound to 127.0.0.1:10203 ONLY:
ss -ltnp | grep 10203   # expect 127.0.0.1, never 0.0.0.0
```

## 4. Install the systemd user unit

```sh
mkdir -p ~/.config/systemd/user ~/.config/faerrin
cp pkg/mouth/deploy/mouth.service ~/.config/systemd/user/
# create ~/.config/faerrin/mouth.env (see .env.example), chmod 600

loginctl enable-linger "$USER"          # run without an active login
systemctl --user daemon-reload
systemctl --user enable --now mouth.service
systemctl --user status mouth.service
journalctl --user -u mouth.service -f  # watch it connect to the gateway
```

## 5. Isolation & safety checklist

- `MemoryMax`/`CPUQuota` in the unit cap the bot so an OOM/spin can't starve aether/Caddy.
  Tune the values to the host (see spec OQ — currently 512M / 50%).
- The axum endpoints are internal-only (`127.0.0.1`). **Do not** add a `sites.caddyfile` entry.
- Crash-loop protection: `StartLimitBurst=5` / `StartLimitIntervalSec=300` stop a bad deploy
  from hammering Discord's identify endpoint (which risks a gateway ban).

## 6. Phase 4 — Postgres → SQLite cutover (freeze window, IRREVERSIBLE once live)

The bot now speaks **SQLite**; it self-creates the schema on first run (`migrations/`). This step
moves the runtime data over and retires Postgres. **Do it in a freeze window — stop the bot first.**
Rows written to SQLite after cutover are lost if you roll back to PG, so keep a PG snapshot.

```sh
cd /ruby/data/experiments/faerrin/pkg/mouth

# 1. Stop the bot (freeze).
systemctl --user stop mouth.service

# 2. Migrate runtime state PG → SQLite. By DEFAULT this EXCLUDES the junk
#    `d123456789` mega-roll (47.16M rows of one pathological pool), keeping the
#    ~19k rows of real history. Use --keep-all to copy everything (~GB file).
PG_URL="postgres://…the old bot DB…" \
  bun scripts/migrate-to-sqlite.ts --out ~/.local/share/faerrin/speaks.db
#   → also accepts --keep-all or --exclude-base <n>

# 3. Point the bot at it (edit ~/.config/faerrin/mouth.env):
#      DATABASE_URL=sqlite:///home/<you>/.local/share/faerrin/speaks.db
#    (triple slash = absolute path). The file is backed up by backing up that path.

# 4. Start + verify a roll persists and a plot renders.
systemctl --user start mouth.service
journalctl --user -u mouth.service -f

# 5. Once happy (keep the PG snapshot N days as fallback), retire Postgres: stop
#    the PG container/service. The identity tables (users/players/characters/
#    campaigns/active_campaign) were already unused since Phase 3 — they die with PG.
```

- **Backups:** the whole datastore is now one file — `cp`/snapshot `speaks.db` (+ `-wal`/`-shm`)
  on a schedule. No `pg_dump`, no daemon.
- **Rollback boundary:** safe to revert to PG only until step 4 writes new rolls. After that, the
  PG snapshot is stale by those rolls — treat step 4 as the point of no return.

## Open (host-owned, not blockers)

- Final `MemoryMax`/`CPUQuota` values for this host.
- The SQLite file path / backup schedule (suggested `~/.local/share/faerrin/speaks.db`).
- A `/healthz` liveness route + healthcheck (spec R-OBS.1) — optional hardening.
