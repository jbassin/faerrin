---
name: mouth-ts-rewrite-deferred
description: a TS rewrite of the speaks bot as @faerrin/mouth was planned and DEFERRED (not worth it now)
metadata:
  type: project
---

Decision (2026-06-09): rewriting the `speaks` Rust Discord bot (now at `services/speaks`, see
[[speaks-migration]]) into a TypeScript Bun package **`@faerrin/mouth` under `pkg/`** was planned
via `/octo:plan` (team mode) and **DEFERRED** — do NOT start it as a standalone project.

**Why defer:** the 4-phase migration removed the things that justified Rust (`uiua`, `pgvector`),
so a TS rewrite is now *feasible* — but it buys **zero functional gain**. It would spend its whole
risk budget re-porting the 1,823-LOC `roller` dice DSL (pratt parser + AST + tree-walking eval) to
reach byte-identical behavior that already exists and is snapshot-tested. The bot is frozen + green;
the Rust tax isn't paid repeatedly. The `wretch` (Python) precedent shows the repo tolerates a lone
foreign-language package when a rewrite buys nothing.

**Trigger that flips it (revisit then):** the next time the gateway/serenity layer or the Dagger
Rust CI lane needs *substantive* work anyway (a Discord API/gateway break, a DSL feature the parser
can't express, a painful Rust-toolchain maintenance event) — then the rewrite rides on work you're
already doing and the marginal cost collapses.

**Approach when triggered (already mapped — see `thoughts/mouth/plans/0001-mouth-ts-rewrite-plan.md`):**
- Port `roller` STANDALONE first, gated by a **Rust-dumped JSONL parity fixture** (`{input,
  ast_sexpr, eval_result}`) + an **injected deterministic RNG** (don't chase cross-lang `rand`
  parity). `eval.rs` is the long pole, not the parser. Hand-written tokenizer + recursive-descent +
  one Pratt loop, no parser deps.
- Then a discord.js shell (skip the client for webhook sends) + `bun:sqlite` (reuse
  `migrations/0001_init.sql`) + raw `Bun.serve` + `Bun.TOML.parse` (validate the shape).
- Run TS + Rust side-by-side on a test guild; keep the musl binary for rollback; then retire
  `services/speaks` + the Dagger Rust lane. ~1–2 weeks, roller port = MODERATE risk (harness-mitigated).
