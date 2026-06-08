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

Opt-in, **default OFF**, pending real-session A/B before flipping defaults:
- **`--two-pass`** — free-text improv (Pass A) → protective dressing (Pass B); the
  structural fix that removes global lookahead. Needs `callText` (added to `@faerrin/llm`).
- **`--sharpen`** — 3 extra LLM calls, one focused per-host voice pass each.
- **`threads` command + cross-session memory** — `content/running-threads.json`
  accumulates inside-jokes/grudges; injected into the script user content as callbacks.

**Remaining decision (needs real generations / API budget):** run two-pass + sharpen on
3–4 real sessions, compare `--lint` deltas (expect R3 meta-recap→0, R6 quip density
down, R2 turn variance up) vs the 8/12 baseline, then decide whether to flip two-pass to
the default. The linter is a measurement tool, NOT a CI gate.

Companion: `2026-06-07-elevenlabs-naturalness.md` is the *acoustic* layer (Stage 4 TTS);
this work is the *script register* layer (Stage 3). They only overlap in `prompt.ts`.
