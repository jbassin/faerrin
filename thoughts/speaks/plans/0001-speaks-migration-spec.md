# NLSpec 0001 — Migrate `speaks_with_passion` into Faerrin (staged hybrid)

**Status:** ✅ ALL PHASES SHIPPED (2026-06-09). P1: vendored + portable. P2: shed `uiua` + vector
embeddings (389→58 crates). P3: identity → `players.toml`. P4: SQLx backend → **SQLite** (bot
self-migrates; only `dice`+`funcs` remain). Whole workspace green. The code migration is complete;
the **production data cutover** (PG→SQLite via `scripts/migrate-to-sqlite.ts`) is the one remaining
host-owned, freeze-window step — see `deploy/CUTOVER.md §6`. See §13.
**Created:** 2026-06-09
**Authoring:** /octo:spec — team mode (Claude persona agents: backend-, database-, cloud-architect)
**Source:** `/ruby/data/experiments/speaks_with_passion` (Rust Cargo workspace, edition 2024)
**Target:** Faerrin monorepo (`/ruby/data/experiments/faerrin`)
**Companion docs:** `.claude/session-plan.md`, `.claude/session-intent.md`

---

## 1. Summary

Bring the `speaks_with_passion` Rust Discord bot into the Faerrin monorepo as a vendored,
polyglot **`services/speaks/`** member, then converge it onto Faerrin's grain in
independently-shippable phases — mirroring how the `wretch` Python package was staged in.
End-state: a smaller bot that **reads campaign/player identity from `@faerrin/content`**,
persists its runtime state in **SQLite**, has **shed the dead `uiua` and vector-embedding
features**, builds in a **dedicated Dagger Rust CI lane**, and deploys as an **isolated,
internal-only service** that cannot threaten the live `heart.iridi.cc` static site.

## 2. Actors

| Actor | Role |
|-------|------|
| Discord players (~5, single campaign) | Issue rolls/commands in the campaign guild |
| The bot (`discord` crate) | serenity autosharded gateway client + `axum` HTTP control plane (:3000) |
| `@faerrin/content` | File SSOT for campaign/player **identity** (roster) |
| Datastore | Bot **runtime** state (roll history, user macros) — Postgres → SQLite |
| Maintainer | Operates deploy via systemd container unit + CUTOVER runbook |
| Dagger CI | Separate Rust lane; existing Bun lanes untouched |

## 3. Current-state inventory (what we're migrating)

- **Crates:** `discord` (serenity 0.12 full + tokio + `axum` 0.8 + `sqlx` 0.8/Postgres +
  `pgvector` + `uiua` + reqwest), `roller` (dice DSL: pratt parser → AST → eval, pure logic,
  no I/O), `chart` (dice-distribution charting).
- **Env actually read** (`env.rs`): `RUST_LOG`, `DISCORD_TOKEN`, `DATABASE_URL`. (The
  `DB_*` keys in `.env` are compose-only, not read by the binary.)
- **Hardcoded values to lift** (Phase 1):
  - `handler.rs:36` — **leaked Discord webhook token** (`DICE_FEED_URL`). ⚠️ rotate + env.
  - `handler.rs:169` — axum binds `0.0.0.0` → must become `127.0.0.1` (internal-only).
  - `handler.rs:773` — `https://feed-ws.iridi.cc/broadcast/roll` (external dice feed) → env.
  - `http.rs:175` — `https://embed.iridi.cc/embeddings` (embedding service) → removed Phase 4.
  - aonprd/imgur asset URLs (handler.rs/host.rs) — cosmetic; move to a config table or leave.
- **DB tables** (from `.sqlx`): `users`, `active_campaign` (**identity**); `dice`, `funcs`
  (**runtime**); `embeddings`, `embedding_listings` (**dead — drop**).
- **HTTP endpoints** (`http.rs`): `speak` (TTS/NPC voice into a channel via webhooks — CORE,
  keep), `save` (embedding ingestion w/ `api_key` — dies with embeddings in Phase 4).

## 4. Scope

**In scope:** vendoring + portability; a Rust CI lane; sourcing identity from content;
Postgres→SQLite cutover; removal of `uiua` + vector embeddings; isolated internal-only
deploy; runbook + package CLAUDE.md.

**Non-goals (explicitly out):**
- A full TypeScript rewrite of the bot (Option B) — `uiua`'s removal *un-blocks* it later,
  but it is NOT part of this spec.
- Any change to the Bun workspace's behavior, build output, or `bun --filter '*'` lanes.
- Any new public subdomain / Caddy reverse-proxy entry.
- Migrating campaign/player *authoring* — content remains the hand-authored SSOT.
- Re-implementing `roller`/`chart` in TS (a separate, optional future idea).

## 5. Data-ownership boundary (the load-bearing rule)

> **Content owns every entity that exists independent of the bot; the datastore owns only
> facts the bot itself emits.**

- **Identity → `@faerrin/content`** (files): campaign + character roster identity, keyed by
  **display name / slug** (e.g. `Josh → Gamemaster`). Source = `campaigns.yaml`.
- **Runtime → SQLite** (bot-owned): `dice` (roll history), `funcs` (user macros). These rows
  reference identity by a **content-stable `player_slug` STRING column**, never a
  bidirectional-ownership FK to a bot-maintained players table.

> ⚠️ **Three identifier spaces — corrected boundary (completeness review).** Content keys
> players by **display name** (`campaigns.yaml`) and the wiki/transcript pipeline keys by
> **Craig recording ID** (`roster.ts`). The bot keys players by **Discord snowflake**.
> Content holds **no Discord snowflakes** and has no reason to. Therefore:
> - **Content owns:** campaign + character roster identity by display-name/slug.
> - **The bot owns a tiny `snowflake → slug` binding** (~5 rows) — Discord-runtime knowledge
>   that does NOT belong in the file SSOT. This is bot config (a small table or a committed
>   `services/speaks/players.toml`), the one piece of "identity" that legitimately stays bot-side.
> - The wholesale "content owns all identity" framing is wrong; this split is the real boundary.

- **Mechanism (Define-resolved):** a Rust binary cannot `import` the TS/YAML SSOT, but it
  doesn't need a new exporter — content **already generates `shibboleth.json`** from
  `campaigns.yaml`, and that file already encodes campaign→player→character identity with
  `isMain` = active campaign. The bot reads `shibboleth.json` by **filesystem path**
  (env-overridable), plus its own `services/speaks/players.toml` for the snowflake binding +
  bot-mechanical fields. Loaded once at startup; no runtime parse of content files in hot paths.

## 6. Phased requirements & acceptance criteria

### Phase 1 — Vendor as-is + make portable (no behavior change)
**R1.1** Cargo workspace copied verbatim to `services/speaks/` (own `Cargo.toml`,
`Dockerfile`, `.sqlx/`), via **jj** (not git).
**R1.2** `services/speaks/CLAUDE.md` + `services/speaks/deploy/` (systemd unit template +
`CUTOVER.md`) authored, mirroring `wretch`'s deploy discipline.
**R1.3** All hardcoded externalized to env with location-derived defaults: `DICE_FEED_URL`
(rotated webhook), `FEED_WS_URL`, axum bind addr/port. `.env.example` documents every key.
**R1.4** ⚠️ The leaked webhook token is **rotated in Discord** and removed from source history
awareness (new value only in untracked `.env`).
**R1.5** axum binds `127.0.0.1` by default (overridable), not `0.0.0.0`.
**R1.6** **Do NOT provision a new Postgres/Podman on the target host.** Phase 1 validates the
vendored binary against the **existing (old-deployment) Postgres** — or a one-time local
snapshot of it — purely to prove parity. The target host never gets a fresh PG daemon; by the
time we deploy clean (Phase 4) the datastore is SQLite. (See §10 D6 + the resequencing note below.)
- **AC1:** `cargo build --release --target x86_64-unknown-linux-musl --bin discord` succeeds.
- **AC2:** Bot behavior is unchanged vs upstream (rolls, `speak`, macros, dice feed) when run
  against the existing Postgres snapshot.
- **AC3:** No occurrence of the old webhook token or a literal `0.0.0.0`/`http(s)://…iridi`
  remains in `services/speaks/` source (`grep` clean).
- **AC4:** `bun --filter '*'` lanes and all site build outputs are byte-identical to pre-migration.

> **🔀 Phase resequencing (Define addendum, 2026-06-09) — PG retired ASAP.** Phases 2–4 were
> reordered so Postgres/Podman die as early as the data dependencies allow and the SQLite port
> surface is minimized. Two hard reasons drive the new order: **(1) `pgvector` is
> Postgres-only — embedding tables CANNOT be carried to SQLite**, so shedding embeddings MUST
> precede the cutover (the old "cutover then shed" order was infeasible); **(2)** moving
> identity to content BEFORE the cutover shrinks the schema to just `dice` + `funcs`, so the
> SQLite port covers 2 tables instead of ~7. New order: **shed → identity-to-content → SQLite.**
> uiua removal is dialect-independent and bundled into the shed phase.

### Phase 2 — Shed dead features (`uiua` + vector embeddings) *(was Phase 4 — moved up)*
Pure subtraction, low risk, and the **prerequisite that unblocks SQLite** (removes the
Postgres-only `pgvector`).
**R2.1** Remove `uiua` dependency and `uiua.rs` + its handler dispatch path.
**R2.2** Remove the vector-embedding subsystem: `db/embedding.rs`, `embeddings` +
`embedding_listings` tables/queries, the `save` HTTP endpoint + `SaveArgs`/`EmbedResp`, the
`embed.iridi.cc` client call, and `pgvector` from `Cargo.toml`.
**R2.3** Remove now-dead code reachable only from the above (dead-code pass; `clippy` clean).
**R2.4** Regenerate `.sqlx/` (`cargo sqlx prepare` against the existing PG) after the embedding
queries/tables are gone, so `SQLX_OFFLINE=true` builds stay green.
- **AC1:** No reference to `uiua`, `pgvector`, `embedding`, or `embed.iridi.cc` remains
  (`grep`/`cargo tree` clean).
- **AC2:** Bot starts and serves rolls/`speak`/macros with the removed paths gone (no panics,
  no dangling routes).
- **AC3:** `clippy -D warnings` passes with no `#[allow(dead_code)]` papering over removals.
- **AC4:** `.sqlx/` regenerated; offline build green. The remaining schema is `dice`, `funcs`,
  and the (about-to-be-removed) identity tables — **no pgvector remains**.

### Phase 3 — Content as identity SSOT *(was Phase 2)*
Shrinks the schema to `dice` + `funcs` **before** the cutover, so Phase 4 ports almost nothing.
**R3.0 (REUSE, don't invent)** The roster contract is the **existing
`pkg/content/scripts/shibboleth.json`** (generated from `campaigns.yaml` by `pipeline/script.ts`):
campaign → players(display-name) → characters(`{name, desc}`), with **`isMain: true` marking the
active campaign** (replaces the `active_campaign` table). Only change to content: add a top-level
`schemaVersion` field.
**R3.1** Bot reads `shibboleth.json` by **path** at startup (env-overridable, default
cwd-relative `../../pkg/content/scripts/shibboleth.json`), replacing reads of `active_campaign`
+ the campaign/character fields of the `users` join.
**R3.2** Bot-owned identity binding = **`services/speaks/players.toml`** (committed config):
holds the fields content has no business carrying — `snowflake → display-name`, `is_admin`,
and per-character `class` + `is_dm`. Runtime tables (`dice`, `funcs`) key off the
**display-name slug STRING**; no FK to a bot-owned identity table. Seed it via a **one-time
export from the existing PG `users` table** (D3) before dropping the identity tables.
**R3.3** Identity loaded once at startup (and on SIGHUP/reload), never per-command; the
`schemaVersion` in `shibboleth.json` guards silent format drift.
**R3.4** Drop the now-unused identity tables (`users`, `players`, `characters`, `campaigns`,
`active_campaign`); regenerate `.sqlx/` so the offline build is green with only `dice`/`funcs`
queries remaining — the final pre-SQLite schema.
- **AC1:** With the identity tables dropped, the bot resolves all ~5 players + the active
  campaign from `shibboleth.json` + `players.toml`.
- **AC2:** Renaming/removing a player in content does NOT orphan or delete historical `dice`
  rows (slug string survives identity changes; no cascade delete).
- **AC3:** No runtime query reads a content file inside a command hot path; `shibboleth.json`
  is loaded once.
- **AC4:** `cargo sqlx prepare` regenerated; offline build green; remaining schema = `dice` + `funcs`.

### Phase 4 — Postgres → SQLite cutover *(was Phase 3 — now a 2-table port; retires PG + Podman)*
**R4.1** Swap the SQLx backend to SQLite (`runtime-tokio` + `sqlite` features); replace
`PgPoolOptions`/`Pool<Postgres>` with the SQLite equivalents; connection-string via env.
**R4.2** Port the **2 remaining tables** (`dice`, `funcs`) + their `.sqlx/` prepared queries;
resolve the (now-small) Postgres→SQLite dialect gaps (see Risks). One-shot **data migration**
exports existing `dice`/`funcs` rows from the old PG → the SQLite file.
**R4.3** SQLite DB file lives on a backed-up path; document backup/restore in CUTOVER.
**R4.4** Cutover is a **freeze-window** operation (bot stopped during export→import), NOT
"independently revertible" once live: rows written to SQLite post-cutover are lost on a PG
rollback. The CUTOVER runbook states the point-of-no-return + a keep-PG(snapshot)-N-days fallback.
- **AC1:** `cargo sqlx prepare` (offline) succeeds against SQLite; `SQLX_OFFLINE=true` build green.
- **AC2:** Roll history + macros are preserved across the cutover (row counts + spot-check match).
- **AC3:** The deployment requires **no database daemon at all** — no Postgres, no Podman; just
  the SQLite file (the wretch "filesystem-as-ledger" grain).
- **AC4:** Runbook documents the freeze window + rollback boundary; PG snapshot retained N days.

## 7. CI / Deploy / Caddy integration

**CI (Dagger):**
- **R-CI.1** New `@func()` (`rustCheck`/`rustBuild`) in `.dagger/src/index.ts` using a
  `rust`/`clux/muslrust` container: `cargo fmt --check`, `clippy -D warnings`, `cargo test`,
  musl release build. Cache volumes for `~/.cargo/registry` + `services/speaks/target`.
- **R-CI.2** It is **excluded** from `bun --filter '*'`; a Rust failure cannot block a
  static-site deploy and vice-versa. Wired as its own CI job.
- **R-CI.3** `services/speaks/` has **no** `package.json` (it would lie — cargo isn't in the
  Bun container) and is NOT a Bun-workspace member.

**Deploy:** *(Define decision: bare systemd user unit, NO container — see §10 D6.)*
- **R-DEP.1** Run the **static musl binary directly** under a **systemd USER service**
  (`Type=simple`, `WorkingDirectory=/ruby/data/experiments/faerrin`,
  `EnvironmentFile=~/.config/faerrin/speaks.env`), mirroring `wretch`'s `deploy/*.service`
  idiom. The cargo-chef Dockerfile is retained only as a CI/build artifact, not the deploy
  vehicle. Templates live in `services/speaks/deploy/` + `CUTOVER.md`.
- **R-DEP.2** Supervision: `Restart=on-failure`, `RestartSec`/backoff + `StartLimit*` caps so
  a crash-loop cannot earn a Discord identify rate-limit/ban. serenity auto-resumes sessions.
- **R-DEP.3** Datastore: **Postgres is a temporary Phases-1–3 dependency** (ideally just the
  existing/old PG or a local snapshot — R1.6 — not a fresh host daemon); it is **removed at
  Phase 4** for a plain, backed-up **SQLite file** (no datastore daemon — the wretch
  "filesystem-as-ledger" grain).
- **R-DEP.4** Isolation: systemd `MemoryMax`/`CPUQuota` cgroup limits + localhost bind; the
  unit shares nothing with the Caddy static host but the kernel. A bot OOM cannot starve
  `heart.iridi.cc`.

**Caddy:**
- **R-CAD.1** axum :3000 (`speak`) is **internal-only**, bound `127.0.0.1`. **No** new entry
  in `sites.caddyfile` (gitignored; edited on host only). Discord traffic is outbound.

**Secrets & runtime state (completeness review):**
- **R-SEC.1** `DISCORD_TOKEN` and the rotated webhook are injected at **runtime** via systemd
  `EnvironmentFile=~/.config/faerrin/speaks.env` (the exact `wretch` precedent — kept out of
  git), NOT in source and NOT baked into the image. The Dockerfile MUST stop `COPY .env .env`
  (it remains only a build image). Verify the deployed env file is `0600` and untracked.
- **R-STATE.1** Per-guild/channel **webhooks for `speak` are held in an in-memory `HashMap`**
  and are re-derived on (re)connect. Spec acknowledges they are lost on restart; verify
  re-creation is idempotent and rate-budget-safe under the Phase-1 restart-backoff policy
  (R-DEP.2). Persisting them is OPTIONAL (out of scope unless restart cost proves painful).

**Testing & observability (completeness review):**
- **R-TEST.1** Inventory existing `cargo test` coverage (`roller` has pure-logic tests worth
  keeping; `discord` gateway handlers likely none). CI `cargo test` (R-CI.1) runs the pure
  crates with **no DB dependency**; any DB-touching test uses an ephemeral SQLite fixture
  (post-Phase-3) — never the deploy PG. serenity handlers are exercised via extracted pure
  functions, not a live gateway.
- **R-TEST.2** Phase-1 "behavior unchanged" (AC2) is validated by a documented **manual
  smoke checklist** against a test guild (roll, macro, `speak`, dice-feed), since no
  gateway-integration harness exists. The checklist lives in `deploy/CUTOVER.md`.
- **R-OBS.1** Structured logs via `tracing` (already present) shipped to the host journal.
  A **liveness signal distinguishing "process alive" from "gateway connected"** is required:
  a `/healthz` axum route reflecting `Ready`/`Resumed` state, wired to a systemd healthcheck;
  alert on repeated identify failures (rate-limit early-warning).

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| **Leaked webhook token** in source (`handler.rs:36`) | Rotate in Discord; move to env; verify grep-clean (Phase 1, R1.4). |
| Blast radius onto live `heart.iridi.cc` | Full isolation (own net, cgroup limits, localhost bind) — R-DEP.4. |
| Discord identify rate-limit/ban on crash-loop | Restart backoff + StartLimit caps — R-DEP.2. |
| SQLx Postgres→SQLite dialect gaps (enums `GameEdition`, `i64`/`int` affinity, `RETURNING`, upserts, types) | Reorder shrinks the surface to **2 tables**: embeddings gone (P2), identity moved to content (P3), so the P4 cutover ports only `dice`/`funcs`. `GameEdition` enum leaves with the campaigns table in P3. |
| Removing `uiua`/embeddings leaves dangling routes/dead code | Subtractive Phase 4 with `clippy -D warnings` + grep gates (R4.3, AC3). |
| Polyglot CI drift / Bun lane contamination | Separate Dagger func, no shared cache keys — R-CI.1/.2. |
| jj/git confusion during vendoring | Use jj per repo rule; no raw git. |
| **`.sqlx/` offline metadata couples schema to compilation** — each table/query removal breaks the offline build until regenerated | Regenerate `cargo sqlx prepare` against the existing PG after **each** subtractive step (R2.4 post-embeddings, R3.4 post-identity) so every phase stays green before the P4 SQLite swap; cargo-chef recipe re-prepared as `Cargo.toml` deps churn. |
| **Secret baked into image** (`COPY .env`) | Runtime injection only — R-SEC.1. |
| **PG→SQLite cutover irreversible once live** | Freeze window + point-of-no-return + keep-PG-N-days — R3.4. |
| **No gateway-integration test harness** | Pure-fn tests + documented manual smoke checklist — R-TEST.1/.2. |
| **Silent gateway disconnect undetectable** | `/healthz` reflecting gateway state + systemd healthcheck — R-OBS.1. |
| **Host assumptions unpinned** (cgroup syntax, Podman vs Docker, SQLite path) | Resolve OQ-1 in Define; pin one container runtime before R-DEP.1 is built. |

## 9. Validation gates (must all pass to call a phase done)

1. **Bun workspace stays green & byte-identical** — `dagger call check` passes; site build
   file-sets unchanged (the 763-file aether invariant).
2. **Rust lane green** — `dagger call rust-check` (fmt/clippy/test/build) passes.
3. **Isolation verified** — bot + datastore bound to localhost/private net; cgroup limits in
   the unit file; a forced bot OOM does not affect `heart.iridi.cc`.
4. **Per-phase ACs** above are met, in order; each phase is independently shippable/revertible.

## 10. Locked decisions (Define — 2026-06-09)

All six open questions resolved against the codebase (`wretch/deploy/`, `shibboleth.json` +
`pipeline/script.ts`, `handler.rs` chart usage, `get_player_profile.sql`).

**D1 — Deploy host: SAME host as aether/Caddy, isolated.**
The monorepo's blessed deploy idiom (verified in `wretch/deploy/`) is **systemd USER units on
the same `/ruby` host** that runs aether/Caddy, with `WorkingDirectory` at the repo root and
`EnvironmentFile` for secrets. No separate box. Isolation (D-cgroups + localhost bind) handles
blast radius. → R-DEP.1/.4.

**D2 — Roster contract: REUSE `shibboleth.json` (no new exporter).**
It already encodes campaign→player→character with `isMain` = active campaign. Add only a
`schemaVersion` field. Bot reads it by path. → R2.0/R2.1.

**D3 — Snowflake binding: one-time EXPORT from the live Postgres `users` table → committed
`services/speaks/players.toml`.**
Real 18-digit snowflakes are authoritative only in the running DB (the seed SQL uses synthetic
int IDs; no snowflakes in source) — export beats hand-authoring (no fat-finger risk). Done in
Phase 2 before identity tables are emptied; the file also carries `is_admin`/`class`/`is_dm`. → R2.2.

**D4 — iridi.cc services:**
- `feed-ws.iridi.cc/broadcast/roll` (dice feed) **STAYS UP** — it's a KEPT feature; Phase 1
  only env-izes the URL. Confirm the endpoint remains served.
- `embed.iridi.cc/embeddings`: Phase 4 removes the **caller**; **decommissioning the service is
  OUT OF SCOPE** (separate ops task, flagged not owned here).

**D5 — `chart` crate: KEEP.**
Its only consumer is the dice-distribution plot (`handler.rs:327/332`, "interval plot"),
unrelated to embeddings. Survives Phase 4. (`roller` likewise stays Rust-internal; a TS
extraction for the sites is a **separate future spec**, explicitly not in scope here.)

**D6 — Container runtime: NONE — bare systemd user service running the static musl binary.**
`wretch` runs its workload as a bare systemd user unit (no container); the bot compiles to a
single static musl binary, so containerizing adds nothing. This **overrides** the earlier
cloud-architect container recommendation on verified repo-precedent grounds. The Dockerfile is
kept only as a CI build artifact. Postgres (Phases 1–3 only) should be the existing/old PG or a
local snapshot — not a fresh host daemon (R1.6); the SQLite end-state needs no daemon at all.
**With the Phase resequencing (§6), the target host ideally never runs Postgres or Podman.** → R-DEP.1/.3.

### Still genuinely open (host-execution, user-owned — not blockers for Phase 1 dev)
- Exact `MemoryMax`/`CPUQuota` values for the unit (tune on the host).
- Whether to point Phases 1–3 at the existing/old Postgres vs a local snapshot vs a short-lived
  Podman container before the Phase-4 SQLite cutover (operator preference; all work — and with
  the resequencing this window is as short as you want, since SQLite can come right after P3).

---

## 12. Completeness review (adversarial persona pass — folded in)

A `backend-architect` persona ran an adversarial completeness challenge against the draft.
Findings were verified against the codebase and folded in above. Summary of what changed:

1. **[Load-bearing] Phase-2 mechanism was unspecified & the `wretch` analogy was false** —
   `wretch` is TS and `import`s `roster.ts`; a Rust binary cannot. Fixed: §5 + R2.0/R2.1 — the
   bot reads content's **already-generated `shibboleth.json`** by path (Define D2 confirmed no
   new exporter is needed; `isMain` replaces the `active_campaign` table).
2. **[Load-bearing] No snowflake↔slug map exists; three identifier spaces** (Discord
   snowflake vs display name vs Craig recording ID). Fixed: §5 corrected boundary — the
   snowflake→slug binding stays **bot-owned** (R2.2, OQ-6).
3. **`.sqlx/` offline coupling across phases** — added regen after each subtractive step
   (R2.4, R3.4) + risk row. *(Phase numbers below reflect the original 4-phase order; see §6
   for the Define resequencing — shed → identity → SQLite.)*
4. **Secret-in-image** (`COPY .env`) — added R-SEC.1 (runtime injection).
5. **"Independently revertible" false for P3** — added R3.4 (freeze window + point-of-no-return).
6. **No testing strategy** — added R-TEST.1/.2 (pure-fn tests + manual smoke checklist).
7. **In-memory webhook state lost on restart** — added R-STATE.1.
8. **No observability for headless gateway** — added R-OBS.1 (`/healthz` + systemd healthcheck).
9. **Unpinned host assumptions** — elevated OQ-1; added risk row.
10. **Scope leak on `embed.iridi.cc`** — clarified caller-removal in-scope vs service-retire
    out-of-scope (OQ-4).

## 13. Progress log

### Phase 1 — SHIPPED 2026-06-09
- Vendored the Cargo workspace to `services/speaks/` (3 crates, `.sqlx/`, Dockerfile) via jj;
  `target/` and `.env` ignored.
- **Portability:** `DICE_FEED_URL` (was a hardcoded **leaked webhook token**), `FEED_WS_URL`,
  `EMBED_URL`, `CHART_BASE_URL` (a 5th iridi literal found in `chart`), and `SPEAKS_BIND_ADDR`
  all moved to env via `LazyLock`; axum now binds `127.0.0.1:10203` (was `0.0.0.0`); `dotenvy`
  made optional so systemd `EnvironmentFile` works with no `.env` present.
- Added `services/speaks/{CLAUDE.md, .env.example, deploy/speaks.service, deploy/CUTOVER.md}`.
- Added Dagger `rustCheck`/`rustBuild` funcs (`clux/muslrust:nightly`, cached), kept out of the
  Bun lanes; verified the module loads (`dagger functions`).
- **Two unplanned, in-spirit fixes (no behavior change):** added `#![recursion_limit = "256"]`
  to the `discord` crate (the `message` handler overflowed the default layout-recursion limit on
  the current toolchain — the source's own `cargo test` didn't even compile without it); and
  refreshed 6 stale `expect_test` snapshots in `roller` (`UPDATE_EXPECT` + 2 manual) to capture
  the vendored parser/eval's actual output — these tests were already failing in the source.
- **Validation:** `cargo check` green; `cargo fmt --check` green; 8 `roller` tests pass; bun
  `--filter '*' typecheck` green; `pkg/` untouched (AC4 byte-identical by construction). clippy
  still reports the pre-existing dead-code warnings (identity fields, unused `Host` variants) —
  these get cleaned in Phases 2–3, at which point the lane escalates to `-D warnings`.
- **⚠️ User action (R1.4):** rotate the leaked Discord webhook — code no longer holds the token,
  but it remains in git history. See `deploy/CUTOVER.md` §1.

### Phase 2 — SHIPPED 2026-06-09
- **`uiua` removed:** dependency, `uiua.rs`, `mod uiua`, the `help`/calculator dispatch in
  `handle_message`/`try_message`, the `uiua`/`pretty_uiua_class`/`uiua_help` methods, and the
  now-orphaned `SyncDie` (it existed only to feed the uiua interpreter — struct field, module,
  `syncdie.rs`). **Dependency tree dropped from 389 → 58 crates.**
- **Vector embeddings removed:** `pgvector` dep, `db/embedding.rs` + `pub mod embedding`, the 4
  `embedding`/`embeddings` `.sql` query files, and in `http.rs` the `save` endpoint + `SaveArgs`
  + `EmbedResp` + `embed()` + `chunk()` + `WATERMARK`/`OVERLAP` + `EMBED_URL`, plus the
  `/api/v1/save` route and the now-dead `HandlerState.db` field. (Discord message *embeds* in
  `host.rs` are untouched — different concept.)
- **Validation:** `cargo check` 0 errors (7 warnings, down from 8); `cargo fmt --check` green;
  8 `roller` tests pass; grep-clean of `uiua`/`pgvector`/`embedding`/`embed.iridi`. The
  remaining warnings are the **identity** dead-code (`Profile` fields, `get_active_campaign`,
  `Campaign`) that Phase 3 removes — so the Dagger clippy lane stays report-only until then,
  escalating to `-D warnings` after Phase 3 (AC3 deferred accordingly).
- **`.sqlx/` note:** the deleted embedding queries leave orphaned `.sqlx/*.json` entries —
  harmless for offline builds (validated). A clean `cargo sqlx prepare` against a live DB at the
  Phase 3/4 cutover removes them.

### Phase 3 — SHIPPED 2026-06-09
- **Design change (supersedes R3.0/R3.1):** the content roster and the bot DB genuinely diverge,
  and `campaigns.yaml` drives the live wiki/caster pipeline (GM detection by name, transcript
  keyword matching) — so making the bot read `shibboleth.json` would either change bot output or
  re-baseline the live `heart.iridi.cc` wiki. **Decision (user): decouple.** The bot reads
  **`players.toml`** (its own file) for identity; content stays SSOT only at the
  **player-display-name** level (Josh/Jorge/Mike/Noah/Tanner match). No content-pipeline changes.
- **`players.toml`** authored from a live-DB pull (`users ⋈ players ⋈ characters ⋈ active_campaign`),
  then reconciled by the user (character labels aligned to content: "Gamemaster", "Through a Song,
  Darkly"; classes kept from the DB). Maps snowflake → player (Jorge has 2 accounts).
- **New `roster.rs`** loads `players.toml` at startup → `snowflake → Profile` map (+ `player_id →
  name` for plot labels). `Profile` trimmed to the 5 fields actually read (`player_id`,
  `player_name`, `campaign_edition`, `character_name`, `character_class`).
- **Removed** the Postgres identity reads: `db/player.rs` (`get_profile`), `Campaign` +
  `get_active_campaign`, `get_player_profile.sql`, `get_active_campaign.sql`. `get_dice_query.sql`
  rewritten to drop the `players` join (returns `player_id`, mapped to a name via the roster).
- **`dice` keeps its integer `player_id`** — the 47M existing rows are untouched (deviation from
  R3.2's "slug string": a 47M-row rewrite for no functional gain). The identity *tables* are no
  longer read; the actual `DROP`s are **gated to the Phase 4 cutover** (still present in the DB now).
- **Validation:** `cargo sqlx prepare` green **against the live DB** (`.sqlx` regenerated; identity
  queries gone); `cargo check` 0 errors (7→4 warnings — all now unrelated cosmetic: `invert`,
  `HostPicker` variants); `cargo fmt --check` green; tests **9 pass** (new `roster` parse/resolve
  test + 8 `roller`); real `players.toml` validated. The identity dead-code that blocked clippy
  `-D warnings` is gone; the remaining 4 are pre-existing cosmetic (a final clippy-clean pass can
  remove `invert` + the dead `HostPicker` variants, then the lane escalates to `-D warnings`).

### Phase 4 — SHIPPED 2026-06-09 (code; production cutover is host-owned)
- **SQLx backend swapped Postgres → SQLite** (`db/mod.rs`: `SqliteConnectOptions` +
  `create_if_missing`; `sqlx` features `postgres,chrono,json,tls` → `sqlite,migrate`; dropped the
  unused `chrono` dep). The bot **self-initializes its schema** via `sqlx::migrate!` from
  `crates/discord/migrations/0001_init.sql` (tables `dice`, `funcs`) — a fresh file just works.
- **Dialect fixes:** `$1`→`?1` placeholders (`insert_die`, `insert_func`); `get_dice_query`
  rewritten from PG `now() - ($2::text)::interval` to SQLite `datetime('now','-' || ?2)` (runtime
  functional-tested: recent rows grouped, player 6 + old rows excluded); `base as i32` bound to a
  `let` (sqlite binds by reference). `.sqlx` regenerated for SQLite.
- **Data scope (your call):** `dice` has **no `campaign_id`**, so a per-campaign filter is
  impossible; a 1-year filter was a no-op (99.99% of rows are < 1y old). The 47M is **one junk
  `d123456789` mega-roll** (47.16M rows) — so the migration **excludes that base**, keeping the
  **19,094** rows of genuine history (`--keep-all`/`--exclude-base` override).
- **Cutover tooling:** `scripts/migrate-to-sqlite.ts` (PG→SQLite, batched, junk-base excluded) —
  **validated end-to-end** against the live DB (19,094 dice + 10 funcs → SQLite; `get_dice`
  resolves real per-player stats). Freeze-window runbook in `deploy/CUTOVER.md §6`; identity-table
  drops happen with PG retirement.
- **Validation:** offline `cargo check` (CI mode) 0 errors; online compile + `cargo sqlx prepare`
  green against a SQLite DB; `cargo fmt --check` green; **9 tests pass**. `*.db` gitignored.
- **End state:** no datastore daemon — the bot is a static musl binary + a SQLite file under a
  bare systemd user unit. Repo's "static + filesystem-as-ledger" grain restored.

**Completeness score (self-assessed): 88/100.** Remaining −12: the six open questions (§10)
are genuine Define-phase decisions (host, roster export format details, snowflake-map source,
chart fate) that cannot be closed without the maintainer — they are correctly deferred, not missing.
