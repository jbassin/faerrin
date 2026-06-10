# CLAUDE.md — `@faerrin/mouth`

A **Rust** Discord bot (PF2e dice/roller + NPC-voice "host"), `pkg/mouth`. It IS a Bun-workspace
member — but a **script-less one**: its `package.json` declares no `typecheck`/`test`/`build`/`lint`
scripts, so the `bun --filter '*'` fan-out simply skips it (exactly like the CSS-only
[`@faerrin/gothic`](../gothic/)). The real build/test runs in a **dedicated Dagger Rust lane**
(`.dagger` → `rustCheck`/`rustBuild`). See the migration spec at
[`thoughts/speaks/plans/0001-speaks-migration-spec.md`](../../thoughts/speaks/plans/0001-speaks-migration-spec.md).

> **Why `pkg/` is fine (was `services/speaks`):** the original objection — "a Rust crate has no
> `package.json` so it can't be a `pkg/*` member" — dissolved once we confirmed `bun --filter`
> skips packages lacking a script (`gothic` proves it). So a thin, script-less `package.json` makes
> it a first-class `pkg/` member without faking cargo-shelling scripts. The eventual TS rewrite
> (see [`thoughts/mouth/plans/`](../../thoughts/mouth/plans/)) becomes an in-place swap.

## ⚠️ Deliberate Rust exception to "Bun everywhere"

Like `wretch` (Python), this package is intentionally not Bun — it's serenity (Discord gateway) +
a dice-DSL parser + SQLx. A TS rewrite is now *feasible* (the `uiua`/`pgvector` blockers were shed)
but was deliberately **deferred** (zero functional gain — see the mouth plan). It builds in the
**Dagger Rust lane**, kept entirely out of `bun --filter '*'`.

## Layout

```
Cargo.toml           # workspace: crates/*
crates/
  discord/           # the bot: serenity gateway + axum control plane (:10203) + SQLx/pgvector
  roller/            # dice DSL — pratt parser → AST → eval (pure, no I/O)
  chart/             # dice-distribution chart URL builder
.sqlx/               # SQLx offline query metadata (SQLX_OFFLINE=true builds)
Dockerfile           # musl/cargo-chef image — CI build artifact only (NOT the deploy vehicle)
deploy/              # systemd user unit + CUTOVER runbook
.env.example         # copy to .env locally; prod uses systemd EnvironmentFile
```

## Run / check

```sh
# from pkg/mouth (needs a host Rust toolchain; musl is CI/Docker only)
SQLX_OFFLINE=true cargo check --workspace
cargo clippy --workspace -- -D warnings
cargo test --workspace          # pure-logic tests (roller); no DB needed
cargo run --bin discord         # needs a populated .env (DISCORD_TOKEN, DATABASE_URL, …)
```

## Config (all env-driven — nothing hardcoded after Phase 1)

`DISCORD_TOKEN`, `DATABASE_URL`, `DICE_FEED_URL` (rotated webhook), `FEED_WS_URL`,
`CHART_BASE_URL`, `MOUTH_BIND_ADDR` (default `127.0.0.1:10203` — internal only),
`MOUTH_PLAYERS_PATH` (default `players.toml`), `RUST_LOG`. See `.env.example`. `.env` is
optional at runtime (dotenvy won't fail if absent; prod supplies env via systemd).

## Identity (`players.toml`)

Player identity is read from **`players.toml`** at startup (snowflake → player + character +
class + edition), not from Postgres. This is the bot-owned half of the identity boundary; the
player `name`s are the SSOT join key with `@faerrin/content` (`campaigns.yaml`). The DB now holds
only **runtime** state (`dice` history keyed by the stable integer `player_id`, and `funcs`
macros). See the spec §5 and `thoughts/speaks/plans/identity-sources.md`.

## Migration status (staged hybrid — see spec)

- **Phase 1 — vendored + made portable.** Hardcoded URLs/secrets → env; axum binds localhost.
- **Phase 2 — shed `uiua` + the vector-embedding subsystem** (unblocks SQLite; pgvector is PG-only).
- **Phase 3 — identity → `players.toml`.** Bot reads `players.toml` instead of the Postgres
  identity tables (`users`/`players`/`characters`/`campaigns`/`active_campaign`). `dice` keeps its
  integer `player_id`. Content stays SSOT at the player-display-name level.
- **Phase 4 — Postgres → SQLite.** SQLx backend is now **SQLite**; the bot self-creates its schema
  (`migrations/`) on first run. Only runtime state remains: `dice` (history) + `funcs` (macros).
  `DATABASE_URL=sqlite:///…`. The data cutover (PG→SQLite, excluding the junk `d123456789`
  mega-roll) is a freeze-window op — `scripts/migrate-to-sqlite.ts` + `deploy/CUTOVER.md §6`.
  No datastore daemon at all.

## Datastore

SQLite, file-based (`DATABASE_URL=sqlite:///path`). Schema in `crates/discord/migrations/`,
applied automatically at startup. Two tables: `dice`, `funcs`. Back up = copy the `.db` file.
CI/offline builds use the committed `.sqlx/` metadata (`SQLX_OFFLINE=true`); regenerate with
`cargo sqlx prepare` against a SQLite file (needs `sqlx-cli` built `--features sqlite`).

## Gotchas

- **Keep the `package.json` script-less.** It's a `pkg/*` member only so it lives beside the other
  packages; if you add a `typecheck`/`test`/`build`/`lint` script, the `bun --filter '*'` fan-out
  will try to run it in the bun container (no cargo there) and break CI. Real checks = the Dagger
  Rust lane.
- The bot dials Discord **outbound**; the axum endpoints are an internal control plane. Do **not**
  add a `sites.caddyfile` entry / public subdomain.
- The datastore is a plain **SQLite file** (`DATABASE_URL=sqlite:///…`); no DB daemon. Back up =
  copy the file.
