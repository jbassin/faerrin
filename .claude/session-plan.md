# Session Plan — Migrate `speaks_with_passion` (Rust Discord bot) into Faerrin

**Created:** 2026-06-09
**Intent Contract:** see `.claude/session-intent.md`
**Workflow:** /octo:plan (team mode — Claude persona agents: database-architect, cloud-architect)

## What You'll End Up With
A decision: the Rust Discord bot vendored into Faerrin as a **polyglot top-level
`services/speaks/`** member, building in a **dedicated Dagger Rust CI lane**, deploying as
an **isolated, internal-only service** that **consumes `@faerrin/content` as identity
SSOT** — staged exactly the way `wretch` was, with the datastore question explicitly
gated for a follow-on decision.

---

## The three options (with trade-offs)

### Option A — Vendor as-is (polyglot monorepo)
Drop the Cargo workspace under `services/speaks/`, keep Rust + cargo-chef Docker, add a
separate Dagger `@func()` (rust container: fmt/clippy/test/musl-build), keep it out of the
`bun --filter '*'` lanes. Deploy the existing musl image under a systemd-supervised
container unit; Postgres/pgvector as its own pinned container on a private network.

- **+** Lowest effort; preserves battle-tested Rust, `uiua`, `pgvector`, serenity.
- **+** Zero risk to the green Bun workspace / live static sites (fully separate lane).
- **−** Repo becomes tri-lingual (Bun + Python + Rust); CI grows a slow Rust toolchain lane.
- **−** Introduces the repo's first persistent daemon + first stateful datastore.

### Option B — Rewrite in TypeScript (`@faerrin/<name>` Bun package)
Reimplement on discord.js; port `roller` DSL to TS; replace sqlx/pgvector with a TS DB
layer; replace axum with Hono/`Bun.serve`.

- **+** Single-language repo; fits existing Bun Dagger CI with zero new toolchain.
- **−** **Near-blocked by `uiua`** (embedded array language, no credible TS equivalent) —
  the *same* reasoning that deliberately kept `wretch` in Python.
- **−** Large rewrite; throws away working code for a cosmetic single-language win.
- **−** Highest risk to "production-ready soon."

### Option C — Hybrid / staged (mirrors `wretch`)  ← recommended
- **Phase 1 — vendor + portability:** Option A mechanically, but made portable
  (env-overridable `DATABASE_URL`/`DISCORD_TOKEN` — already via dotenvy; lift the
  hardcoded `DICE_FEED_URL` webhook + any host paths into env). Add `services/speaks/`
  CLAUDE.md + `deploy/` runbook like wretch.
- **Phase 2 — content as identity SSOT:** bot reads roster/campaign **from
  `@faerrin/content`** (the wretch `src/roster.ts` precedent) instead of its own
  `campaigns`/`players` tables. Bot's runtime rows (dice history, embeddings) key off the
  **content-stable player slug string** — never bidirectional ownership.
- **Phase 3 (optional) — shed accidental complexity:** evaluate replacing Postgres with
  SQLite + `sqlite-vec` (SQLx speaks SQLite first-class). See debate checkpoint below.

- **+** Proven, blessed in-repo pattern; production-ready Phase 1 fast, convergence later.
- **+** Directly satisfies "must fit architecture" + "production-ready."
- **−** Requires the discipline of a documented convergence path (not just a dump-in).

---

## Persona-team findings (the load-bearing calls)

**Data ownership (database-architect):** content owns every entity that exists
independent of the bot (campaign/player **identity**); Postgres owns only bot-emitted
facts (dice history, embeddings). Store `player_slug TEXT` on runtime rows, **not** a FK
to a bot-owned players table; if DB integrity is wanted, materialize a *read-only* derived
players table at build time and FK to that. Seed via **build-time export from content**,
never runtime cross-reads in hot paths. **Verdict: REPLACE Postgres with SQLite +
sqlite-vec** — a standing PG server is accidental complexity for ~5 players.

**Deploy + CI (cloud-architect):** separate Dagger Rust `@func()` (never add cargo to the
Bun base — ~1.5GB bloat, couples cache keys); cache `~/.cargo/registry` + `target/`. Place
at **top-level `services/`**, NOT a fake `pkg/speaks/package.json` (cargo isn't in the Bun
container, so the scripts would lie). Ship the existing **musl image under a
systemd-supervised container unit** (`Restart=on-failure`, backoff caps so a crash-loop
can't earn a Discord identify-ban). axum :3000 is **internal-only** — Discord dials *out*,
so **no new Caddy subdomain**; bind `127.0.0.1`. **Isolate blast radius** from
`heart.iridi.cc` (own container network, cgroup limits, automated `pg_dump`). **Verdict:
CONTAINER + self-managed pgvector container.**

**The productive disagreement:** REPLACE-with-sqlite (DB persona) vs KEEP-pgvector-container
(cloud persona). Both are right within their lens — sqlite is the cleaner architectural
grain; pgvector-container is the lower-touch Phase-1 move (zero Rust changes). Resolution:
**Phase 1 keeps Postgres-in-container** (don't touch the Rust DB layer while landing it);
**Phase 3 decides** sqlite-vec via the debate checkpoint.

---

## Phase Weights (this is a research→decision plan with a production end-state)
- **Discover: 35%** — map options/implications (largely done in this session).
- **Define: 25%** — lock the contested boundaries: placement (`services/`), data
  ownership (slug, not FK), deploy shape (container+systemd), datastore (PG now / sqlite later).
- **Develop: 25%** — Phase-1 vendor + portability + Rust Dagger lane + deploy units.
- **Deliver: 15%** — validate: Bun workspace stays green & byte-identical, bot builds in CI,
  deploy/CUTOVER runbook, isolation verified.

## 🐙 Debate Checkpoints
🔸 **After Define:** "Postgres-in-container vs shed to SQLite + sqlite-vec?" — the one
   genuine fork (the two personas split here). 1-round adversarial.
🔸 **After Develop:** "Is Phase 1 isolated enough to never threaten `heart.iridi.cc`?" —
   1-round collaborative on blast radius + backups.

## Recommendation
**Option C (hybrid/staged), with Phase 1 == Option A mechanically.** It is the only path
that satisfies all four intent constraints at once (working soon, clearly understood,
production-ready, fits the architecture), it reuses the repo's own proven `wretch`
playbook, and it sidesteps Option B's `uiua` blocker. Correct the original framing up
front: **the DB does not move into `@faerrin/content`** — content becomes the *identity*
SSOT while the bot keeps a (narrowed) runtime store.

## Execution Commands
To execute this plan:
```
/octo:embrace "Migrate speaks_with_passion Rust Discord bot into Faerrin via the staged hybrid (Option C): vendor to services/speaks, Rust Dagger lane, content as identity SSOT, isolated container deploy"
```
Or run phases individually: `/octo:discover` → `/octo:define` → `/octo:develop` → `/octo:deliver`.
(Per repo convention, a project-local plan can also be written under `thoughts/speaks/plans/` via the `create-plan` skill.)

## Provider Requirements
🔵 Claude: Available ✓ (team mode via octo persona agents — the intended diversity here)
🔴 Codex / 🟡 Gemini / 🟤 OpenCode / others: not installed — expected for this repo, not a blocker.

## ✅ DECISION LOCKED (2026-06-09)
Approach = **Option C (hybrid/staged)**. End-state is now explicit:
- **Datastore:** converge Postgres → **SQLite + sqlite-vec → (then drop vector store entirely)**.
- **Shed dead features:** **`uiua`** (array language) and **vector embeddings/pgvector** are
  no longer used — removed during the staged convergence. Dropping `uiua` also un-blocks a
  possible eventual TS rewrite, but that is out of scope for this spec.
- Staging still mirrors `wretch`: vendor-as-is → content as identity SSOT → SQLite cutover →
  feature removal.
- **Next artifact:** an NLSpec via `/octo:spec` (in progress).

## Open Questions for You
1. **Datastore now:** keep pgvector-in-container for Phase 1 (recommended, zero Rust churn)
   or go straight to sqlite-vec?
2. **Scope of port:** is `roller` (the dice DSL) wanted as a reusable TS lib for the sites
   (vellum/aether), or does it stay Rust-internal to the bot?
3. **Where does it deploy** — same host as aether/Caddy (with isolation), or a separate box?
