# Session Plan — `speaks` (Rust) → `@faerrin/mouth` (TypeScript)

**Created:** 2026-06-09
**Intent Contract:** `.claude/session-intent.md`
**Workflow:** /octo:plan (team mode — typescript-pro + backend-architect personas)

## TL;DR Recommendation

**DON'T do the rewrite as a standalone project now — DEFER it, with a trigger.** The 4-phase
migration already removed the things that justified Rust (`uiua`, `pgvector`), so a TS rewrite is
now *feasible* — but feasibility isn't justification. A rewrite would spend its entire risk budget
re-porting the 1,823-LOC `roller` dice DSL to reach **byte-identical behavior you already have**:
zero functional gain. That's churn, not consolidation.

**Trigger that flips the decision:** the next time the gateway/serenity layer (or the Rust CI lane)
needs *substantive* work anyway — a Discord API/gateway break, a DSL feature the current parser
can't express, or a painful Rust-toolchain maintenance event. Then the rewrite rides on work you're
already paying for and the marginal cost collapses. Until then, the lone Rust package is a frozen,
tested, bounded cost — the same pragmatic exception the repo already grants `wretch` (Python).

The rest of this plan is the **ready-to-execute approach** for when you pull that trigger (or if you
decide the single-language goal is worth it anyway).

## What You'll End Up With (if/when executed)
`pkg/mouth` — a `@faerrin/mouth` Bun-workspace member (discord.js bot + a parity-tested TS port of
the roller DSL) that joins the uniform `bun --filter '*'` lanes, lets the **Dagger Rust lane be
retired**, and deploys as a bun systemd unit like `wretch`. `services/speaks` (Rust) is removed
only after the TS bot proves out side-by-side.

## The honest trade (why defer)

| Buys | Costs |
|------|-------|
| Drops the bespoke Dagger Rust lane → uniform bun lanes | Re-ports 1,823 LOC of working, snapshot-tested DSL for **no behavioral gain** |
| One language; no Rust/nightly toolchain for contributors | discord.js ≠ serenity → re-validate a live bot |
| Simpler deploy (bun unit, no musl cross-compile) | Throws away just-migrated, green Rust |
| "Last non-Bun-except-wretch package gone" (aesthetic) | A 2nd migration project for a 5-player bot |

**Decisive asymmetry (backend-architect):** consolidation pays off only when it removes a *recurring*
cost paid on every change. This bot is **frozen and green** — the Rust tax isn't being paid
repeatedly. The one argument with teeth is the maintenance tax (keeping Rust/nightly alive for one
binary), but the brittle surface is the small, swappable *gateway* layer — not the large, stable
*roller* — so it's bounded and doesn't clear the bar of a 2nd migration + live-bot regression risk.

## Approach (when executed) — stack decisions

- **Discord:** discord.js (pin the version). For the webhook-based "host voice" sends you can skip
  the gateway client entirely and just POST the webhook URL. Map serenity's autosharded gateway →
  discord.js `Client` with the right intents/partials.
- **Roller DSL (the crux):** **hand-written tokenizer + recursive-descent + one Pratt
  precedence-climbing loop, no parser deps.** The grammar is small and is exactly Pratt's sweet spot
  (binops w/ precedence, prefix unary neg, `.` infix method-call, `f(..)` postfix, lists, lambdas
  `|a,b| …`, `let … in …`). A combinator lib (parsimmon/arcsecond) adds a dep + a second mental
  model for no gain; this keeps the port a near-mechanical transliteration of `parser.rs` +
  `pratt_parser.rs`. ~250–350 TS LOC for the parser.
- **SQLite:** `bun:sqlite` (native, zero deps) — the schema is 2 tables; reuse
  `migrations/0001_init.sql`. Skip drizzle/kysely (their value is migrations/large schemas you lack);
  hand-type the rows.
- **HTTP:** one localhost endpoint → raw `Bun.serve` (no Hono needed); keep `127.0.0.1` bind.
- **players.toml:** `Bun.TOML.parse` (native) — but it's parse-only and yields `any`/`Date`, so
  validate the shape (zod or a hand guard).
- **chart:** trivial TS URL-builder port.

## The de-risking move (roller parity harness)

This is the single most important thing and what makes the rewrite safe:
1. Add a Rust `--dump-fixtures` mode that walks the existing `expect_test` corpus and emits a
   language-neutral **JSONL fixture**: `{ input, ast_sexpr, eval_result }`, using one canonical
   s-expression serializer that matches the shape the Rust snapshots already use
   (`(Die . "8d6")`, `Ok(Cmd { display: […] })`). A Rust test asserts the serializer reproduces the
   recorded snapshots — proving the fixture faithfully reflects current behavior (can't drift).
2. The TS port implements the **same** serializer; a Bun test walks the same fixture and asserts
   byte-identical output. The fixture is generated from Rust, so TS must match it.
3. **RNG:** don't chase cross-language `rand` parity (a rabbit hole). Abstract dice behind a
   `Roller.next()` interface; inject a deterministic scripted RNG (identical fixed sequence / trivial
   seeded LCG on both sides) for parity tests. Keep `from_entropy` in production behind the same
   interface. You only need seeded-eval parity, not RNG-format archaeology.

## Staging (reversible)
1. **Port `roller` standalone first** as a parity-gated TS lib, validated against the Rust fixture
   corpus — *before* touching Discord. This is the risk; isolate it.
2. Wrap it in the discord.js bot shell (gateway, webhook sends, SQLite, players.toml, axum→Bun.serve).
3. Run the TS bot **side-by-side** with the Rust bot on a test guild; diff behavior.
4. Cut over (swap the systemd unit); **keep the musl binary deployable for instant rollback**.
5. Only then retire `services/speaks` + the Dagger Rust lane.

## Effort / risk
- **~1–2 focused weeks**, ~1,200–1,500 TS LOC. **`eval.rs` (349 LOC) is the long pole, not the
  parser** — Rust's move/borrow + closure capture-by-value vs JS reference semantics is where subtle
  divergences hide; concentrate parity fixtures there.
- **Roller port: MODERATE risk**, fully mitigated by the parity harness. Everything else is LOW.

## Phase Weights (research→decision, with a deferred build path)
- **Discover 30%** — landscape mapped (this session).
- **Define 30%** — the gating decision is *whether to proceed at all*; lock the trigger + the
  parity-harness contract.
- **Develop 25%** — staged roller-first port (only on trigger).
- **Deliver 15%** — side-by-side parity validation + cutover/rollback.

## 🐙 Debate Checkpoints
🔸 **Before any code:** "Do it now vs defer-with-trigger?" — the personas split toward DEFER; this is
   the real decision. (Adversarial.)
🔸 **After roller port (if proceeding):** "Is parity proven against the Rust fixture corpus?" — gate
   before wrapping it in Discord.

## Execution Commands
If you decide to proceed:
```
/octo:embrace "Rewrite speaks as @faerrin/mouth: port roller to TS first (parity-gated against a Rust-dumped fixture corpus), then a discord.js bot shell with bun:sqlite + Bun.serve, run side-by-side, then retire services/speaks + the Dagger Rust lane"
```
A project-local copy of this plan is at `thoughts/mouth/plans/`.

## Provider Requirements
🔵 Claude: Available ✓ (team mode via octo persona agents)
🔴 Codex / 🟡 Gemini / 🟤 OpenCode: not installed — expected for this repo, not a blocker.
