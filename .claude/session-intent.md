# Session Intent Contract

**Created:** 2026-06-09
**Workflow:** /octo:plan (team mode — Claude persona agents)

## Job Statement
Migrate the `speaks_with_passion` Rust Discord bot
(`/ruby/data/experiments/speaks_with_passion`) into the Faerrin Bun/TypeScript
monorepo, landing on a concrete, production-ready, architecture-fitting approach.

## Captured Intent (5-question calibration)
- **Goal:** Research a topic — map all options + implications before committing.
- **Knowledge:** Well-informed — knows both codebases; wants trade-offs, not a primer.
- **Success:** Working solution + Clear understanding + Production-ready (wired into
  CI/Dagger, Caddy, deploy — not just dropped in).
- **Constraints:** Must fit architecture — respect Bun-workspace conventions, jj VCS,
  Dagger CI, and the `@faerrin/content` file-SSOT.

## Success Criteria
1. A clear, defensible recommendation among vendor-as-is / TS-rewrite / hybrid.
2. End-state is a bot that runs *inside* this repo and deploys without breaking the
   green workspace or the live `heart.iridi.cc` static site.
3. Honest correction of any framing that doesn't fit the architecture (esp. the
   "port the DB into @faerrin/content" idea — content is files, not Postgres).

## Boundaries
- Do NOT break the Bun-only `bun --filter '*'` CI lanes or the live Caddy-served sites.
- Do NOT fabricate Bun-workspace membership for a Rust crate.
- VCS is jj, not git.

## Source-of-truth Findings (grounding)
- Source = Rust Cargo workspace (edition 2024): crates `discord` (serenity autosharded
  gateway + axum :3000 + sqlx/pgvector), `roller` (dice DSL: pratt→AST→eval), `chart`.
  Also embeds `uiua` (array language — no TS equivalent).
- Target Dagger CI = pure Bun (`oven/bun:1.3.14`); no Rust, no DB.
- `@faerrin/content` = file SSOT (markdown wiki + JSON transcripts); zero Postgres in repo.
- `wretch` = the in-repo precedent for vendoring a non-Bun service (vendor-as-is →
  portable → documented hybrid → systemd deploy + CUTOVER runbook; consumes content roster).
