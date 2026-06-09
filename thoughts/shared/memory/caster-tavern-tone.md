---
name: caster-tavern-tone
description: caster's script stage was reworked to feel like a tavern table not a podcast; two-pass/sharpen/threads are opt-in flags pending real-session A/B
metadata:
  type: project
---

The caster `script` stage was reworked (June 2026, plan
`thoughts/caster/plans/2026-06-08-tavern-table-tone.md`) to make the 3-host recap
*feel like friends at a tavern table* instead of a polished podcast. Diagnosis: the
old output was "too good" — every line a clean witty zinger, three equally-articulate
voices, secretly marching the digest beats in order. Root cause = one-shot
structured-tool generation gives the model global lookahead, so it pre-polishes.

All shipped to `main` (commits Phases 1–5b). What exists now:

- **Phase 1 (default, always on):** asymmetric host voices in `hosts.ts` (Bram
  fluent-but-imprecise / Maeve precise-but-terse / Pip fast-but-scattered) + an
  anti-pattern block, tavern-room grounding, and a counted imperfection budget in the
  script system prompt; `renderBeat` de-structured (dropped `BEAT n` ordinals + `Mood`).
- **Phase 2 (tooling):** `bun run script <id> --lint` — a mechanical "tavern-ness"
  linter (`src/script/lint.ts`, R1–R6, max 12). Baseline on the OLD prompt
  ("A Tithe of Hearts") = **8/12 with R4 disfluency at 0** — the polished fingerprint.
  Thresholds are PROVISIONAL (fixture-calibrated, not real-episode-calibrated).
- **Phase 4 (default):** optional `tableAngle` per beat (distill enrichment) — "what
  the friends would argue about" — seeds friction; strict-schema required, type/parser
  optional so old digests still parse.

- **Two-pass is now the DEFAULT** (`generateScript` `twoPass ?? true`): free-text improv
  (Pass A) → protective dressing (Pass B), the structural fix that removes global
  lookahead. Needs `callText` (added to `@faerrin/llm`; the real `AnthropicClient` has it).
  Opt out with **`bun run script <id> --one-shot`** (also `{ twoPass: false }` in code —
  the one-shot unit tests use that since their stubs are callTool-only).

Still opt-in, **default OFF**:
- **`--sharpen`** — 3 extra LLM calls, one focused per-host voice pass each.
- **`threads` command + cross-session memory** — `content/running-threads.json`
  accumulates inside-jokes/grudges; injected into the script user content as callbacks.

The `--lint` linter is a measurement tool, NOT a CI gate. To validate tone changes, run
on real sessions and compare deltas vs the 8/12 baseline (expect R3 meta-recap→0, R6 quip
density down, R2 turn variance up). Cached scripts under `out/` predate two-pass — use
`--force` to regenerate them through the new default.

**Ordering revision (June 2026):** the original rework treated "marching the digest beats
in order" as part of the disease and told the script/improv prompts to scramble order
("Follow what's INTERESTING, not a running order", "not in order... double back"). That
was over-corrected — episodes became hard to follow. The prompts now ask the table to
**walk the session ROUGHLY IN ORDER** (distill already emits beats chronologically), while
keeping every other safeguard: cold-open/start-mid-conversation, skip-dull/linger-good,
occasional glance-back, and — crucially — **no verbalized agenda** ("first up", "moving on",
"finally"), which `lint.ts` META_RECAP_PATTERNS still flags. The distinction that matters:
*rough chronological through-line = wanted; mechanical list-recitation / spoken structure =
still forbidden*. Changed in `buildScriptSystemPrompt`, `buildImprovSystemPrompt` (the
default Pass-A path), `buildScriptUserContent`'s beat-pool framing, and `renderBeat`'s
rationale (ordinals still omitted, but now to avoid lockstep recitation, not to hide order).

**Room-interaction removal + R5 retired (June 2026):** the original design told the prompts
to "let THE ROOM intrude" (mug goes empty, someone steals a chip, barkeep, food) and the
lint rewarded that via **R5 (room / sensory references, `dir:"high"`, ≥4 for full marks)**.
That pulled listeners out of the recap — the table got bogged down ordering food/drink.
Changed: the prompts now keep the tavern as WARM BACKGROUND only (no waiter/barkeep, no
ordering, no food/drink stage business — "lost in the STORY, not in their dinner"), in both
`buildScriptSystemPrompt` (`THE SETTING`, replacing `THE ROOM`) and the default
`buildImprovSystemPrompt`. Because the lint then rewarded exactly what we removed, **R5 was
retired entirely**: `ROOM_WORDS` + the `roomReferences` metric deleted, the rubric is now
**R1-R4 and R6, max 10** (`= THRESHOLDS.length * 2`, computed dynamically; `formatReport`
no longer hardcodes `/12`). The R5 id is intentionally left as a GAP (R6 keeps its id) to
preserve the R1-R9 rubric numbering. NOTE: the old "8/12" baseline above is pre-retirement;
re-baseline against `/10` on real episodes. The tavern is still the *setting* — it just
never becomes *stage business*.

Companion: `2026-06-07-elevenlabs-naturalness.md` is the *acoustic* layer (Stage 4 TTS);
this work is the *script register* layer (Stage 3). They only overlap in `prompt.ts`.
