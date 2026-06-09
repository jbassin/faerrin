# CLAUDE.md — `speaks`

A **Rust** Discord bot (PF2e dice/roller + NPC-voice "host") vendored into the Faerrin
monorepo. It is **not** a Bun-workspace member — it lives under `services/` (not `pkg/`)
precisely because it has no `package.json` and cargo isn't in the Bun CI container. See the
migration spec at [`thoughts/speaks/plans/0001-speaks-migration-spec.md`](../../thoughts/speaks/plans/0001-speaks-migration-spec.md).

## ⚠️ Deliberate Rust exception to "Bun everywhere"

Like `wretch` (Python), this package is intentionally not Bun. It depends on serenity (Discord
gateway), `uiua` (an embedded array language with no TS equivalent), and SQLx. Rewriting in TS
was rejected for the same reason `wretch` stayed Python. It builds in a **dedicated Dagger Rust
lane** (`.dagger` → `rustCheck`/`rustBuild`), kept entirely out of `bun --filter '*'`.

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
# from services/speaks (needs a host Rust toolchain; musl is CI/Docker only)
SQLX_OFFLINE=true cargo check --workspace
cargo clippy --workspace -- -D warnings
cargo test --workspace          # pure-logic tests (roller); no DB needed
cargo run --bin discord         # needs a populated .env (DISCORD_TOKEN, DATABASE_URL, …)
```

## Config (all env-driven — nothing hardcoded after Phase 1)

`DISCORD_TOKEN`, `DATABASE_URL`, `DICE_FEED_URL` (rotated webhook), `FEED_WS_URL`, `EMBED_URL`,
`CHART_BASE_URL`, `SPEAKS_BIND_ADDR` (default `127.0.0.1:10203` — internal only), `RUST_LOG`.
See `.env.example`. `.env` is optional at runtime (dotenvy won't fail if absent; prod supplies
env via systemd).

## Migration status (staged hybrid — see spec)

- **Phase 1 (this) — vendored + made portable.** All hardcoded URLs/secrets externalized to env;
  axum binds localhost; `.env` made optional for systemd. No behavior change.
- Phase 2 — shed `uiua` + the vector-embedding subsystem (unblocks SQLite; pgvector is PG-only).
- Phase 3 — read campaign/player identity from `@faerrin/content`'s `shibboleth.json`; bot keeps
  a `players.toml` for the snowflake binding. Runtime schema shrinks to `dice` + `funcs`.
- Phase 4 — Postgres → SQLite cutover; no datastore daemon at all.

## Gotchas

- **Don't move this under `pkg/`** — `bun --filter '*'` would try to treat it as a workspace
  member. It is `services/`-only by design.
- The bot dials Discord **outbound**; the axum endpoints are an internal control plane. Do **not**
  add a `sites.caddyfile` entry / public subdomain.
- Postgres is **temporary** (Phases 1–3). The end-state is a plain SQLite file — don't invest in
  PG infra on the host.
