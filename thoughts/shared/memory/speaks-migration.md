---
name: speaks-migration
description: plan/spec to migrate the speaks_with_passion Rust Discord bot into Faerrin as services/speaks (staged hybrid)
metadata:
  type: project
---

Decision (2026-06-09): migrate the `speaks_with_passion` Rust Discord bot (originally at
`/ruby/data/experiments/speaks_with_passion`) into Faerrin via a **staged hybrid (Option C)**,
mirroring how [[listener-wretch-migration]] vendored a non-Bun package. Chosen over a TS
rewrite (blocked by the `uiua` array language — no TS equivalent) and over pure vendor-as-is.

**End-state:** vendor the Cargo workspace at top-level **`services/speaks/`** (NOT `pkg/` — a
Rust crate has no `package.json` and cargo isn't in the Bun CI container; a fake wrapper would
lie). Dedicated Dagger Rust `@func()` lane, kept out of `bun --filter '*'`. **Shed dead
features `uiua` + vector embeddings**, move identity to content, converge to **SQLite**. Deploy
as a bare **systemd user service running the static musl binary** (no container), axum :3000
bound 127.0.0.1, no new Caddy subdomain.

**Progress:** Phase 1 SHIPPED 2026-06-09 (committed + pushed to main) — vendored to
`services/speaks`, all hardcoded URLs/secrets env-ized, axum binds localhost, optional dotenv for
systemd, Dagger `rustCheck`/`rustBuild` lane, deploy unit + CUTOVER. Needed `#![recursion_limit]`
on the discord crate + refreshed stale roller `expect_test` snapshots (both pre-existing issues).
Whole workspace green. **User must rotate the leaked webhook (still in git history).**
Phase 2 SHIPPED 2026-06-09 (pushed) — shed `uiua` + vector embeddings (deps 389→58 crates);
removed orphaned `SyncDie` + `HandlerState.db`.
Phase 3 SHIPPED 2026-06-09 (pushed) — identity → `players.toml` (new `roster.rs`), **decoupled
from content's pipeline** (content's `campaigns.yaml` drives the live wiki/caster, and the rosters
diverge — so making the bot read shibboleth would change bot output or re-baseline the live wiki;
user chose decouple). Bot no longer reads the PG identity tables; `dice` keeps integer `player_id`
(47M rows untouched). `.sqlx` regenerated against the **live DB** (DATABASE_URL is in
`/ruby/data/experiments/speaks_with_passion/.env`, host localhost:9556). Identity-table `DROP`s
gated to Phase 4. Remaining clippy warnings are pre-existing cosmetic only.
Phase 4 SHIPPED 2026-06-09 (pushed) — SQLx backend Postgres→**SQLite** (`db/mod.rs`
`SqliteConnectOptions` + self-migrate via `crates/discord/migrations/`); dialect fixes
(`$1`→`?1`, `get_dice` uses `datetime('now','-'||?2)`). **The 47M dice rows were ONE junk
`d123456789` mega-roll** — migration excludes that base, keeping 19,094 real rows
(`scripts/migrate-to-sqlite.ts`, validated against live PG). `dice` has no `campaign_id` so
per-campaign filtering was impossible. End state: static musl binary + a SQLite file, no DB daemon.

**ALL 4 PHASES of the code migration are DONE + pushed to main; workspace green throughout.**
Remaining = **host-owned production cutover only** (run `scripts/migrate-to-sqlite.ts` in a freeze
window, switch DATABASE_URL to `sqlite:///…`, retire PG + drop identity tables, rotate the leaked
webhook) — see `services/speaks/deploy/CUTOVER.md`. Note: needed `sqlx-cli` rebuilt
`--features sqlite` for `.sqlx` regen; offline CI builds use the committed sqlite `.sqlx`.

**Phase order (RESEQUENCED 2026-06-09 to retire PG/Podman ASAP):**
1 vendor + portability (validate against the OLD/snapshot PG; never provision a fresh host PG) →
2 **shed uiua + embeddings** → 3 identity-to-content → 4 **Postgres→SQLite cutover**.
Two hard reasons for this order: **`pgvector` is Postgres-only so embeddings MUST be shed
BEFORE SQLite** (the original "cutover-then-shed" was infeasible); and moving identity to content
before the cutover shrinks the SQLite port to **2 tables** (`dice`, `funcs`). Net: the target
host ideally never runs Postgres or Podman at all.

**Spec:** `thoughts/speaks/plans/0001-speaks-migration-spec.md` (4 phases; Defined — ready for
Phase-1 dev). Companion planning at repo-root `.claude/session-plan.md` + `.claude/session-intent.md`.

**Define decisions locked (2026-06-09, §10 of spec):**
- **Deploy = bare systemd USER service running the static musl binary** on the SAME `/ruby`
  host as aether/Caddy — NO container (verified `wretch/deploy/` precedent; overrides an earlier
  container recommendation). Dockerfile kept only as a CI build artifact. Secrets via
  `EnvironmentFile=~/.config/faerrin/speaks.env`.
- **Roster = reuse the existing `pkg/content/scripts/shibboleth.json`** (generated from
  `campaigns.yaml`); `isMain:true` = active campaign (replaces the bot's `active_campaign` table).
  No new exporter; just add a `schemaVersion`.
- **Snowflake binding = one-time export from the live Postgres `users` table →
  `services/speaks/players.toml`** (also holds is_admin/class/is_dm). Real snowflakes live only
  in the running DB, not the seed SQL.
- `chart` crate KEEPT (dice-distribution plot, unrelated to embeddings); `feed-ws.iridi.cc`
  dice feed STAYS; decommissioning `embed.iridi.cc` is out of scope (caller-removal only).

**Non-obvious gotchas surfaced (the load-bearing ones):**
- **Three disjoint identifier spaces.** The bot keys players by **Discord snowflake**; content
  keys by **display name** (`campaigns.yaml`) and by **Craig recording ID** (`roster.ts`).
  Content holds **no Discord snowflakes**. So "content owns all identity" is wrong: content
  owns campaign/character roster by display-name/slug, but the **snowflake→slug binding stays
  bot-owned** (~5 rows). A Rust binary can't import the TS/YAML SSOT — content must emit a
  generated `roster.json` (precedent: `shibboleth.json`) that the bot reads by path.
- **Leaked secret:** a full Discord webhook token is hardcoded at
  `crates/discord/src/handler.rs:36` in the source bot — must be rotated + moved to env on vendor-in.
