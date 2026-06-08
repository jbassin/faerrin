# Caster — Tavern-Table Script Tone (staged plan)

**Created:** 2026-06-08
**Package:** `@faerrin/caster` (`pkg/caster`)
**Stage touched:** Stage 3 (`script`) primarily; Stage 2 (`distill`) in P1 (schema enrichment).
**Source of analysis:** `/octo:brainstorm` session 2026-06-08 (3 Claude personas — dramaturg,
ai-engineer, product-writer — over the real `prompt.ts`/`hosts.ts` + a real generated sample).

## Goal

Make caster's generated recap **feel like three friends talking at a tavern table**, not the polished,
"podcasty" register it has now. This is a **script-text** problem (Stage 3), distinct from the acoustic
naturalness work in the sibling plan.

**Diagnosis (why it sounds podcasty today).** The output is *too good*: every line is a clean, complete,
witty zinger; all three hosts are equally articulate; and the conversation secretly **marches through
the digest's ordered beats**. Three root causes:

1. **Global lookahead.** One-shot, whole-episode generation via the structured `record_script` tool
   call lets the model see turn 40 while writing turn 3 — exactly what lets it pre-resolve every setup
   with a payoff, balance the floor, and recite the beats in order.
2. **The clean-prose pull.** The model treats "interruptions / friction / chemistry" as *topics to
   depict* rather than *constraints on generation*, and reverts a fumble back to a complete line.
3. **The input is a podcast skeleton.** An ordered beat list with `why-it-mattered` + `mood` labels is
   itself an outline; the model walks it and even narrates the labels ("the next big thing was…").

**The current prompt already asks for chemistry, interruptions, and a shared floor** (see
`prompt.ts:22-44`). So the fix is **constraints + voice asymmetry + a physical room** *and* the
**structural change (two-pass generation)** that removes the global-lookahead root cause — not more
adjectives.

**Full scope is committed: every phase below (through the depth work) ships — there is no
"stop after the prompt edits" decision point.** The sequencing puts the prompt foundation first because
the two-pass *improv* step reuses it, then **pulls two-pass forward as its own early phase** (it is the
root-cause fix, not a fallback), and stands up the linter as a **measurement/regression** layer to
*tune and protect* each phase — not to decide *whether* to keep going.

## Sibling plan / de-confliction

`thoughts/caster/plans/2026-06-07-elevenlabs-naturalness.md` covers the **acoustic** layer (Stage 4/5:
stability+seed, lossless intermediate, inline IPA, and an audio-tag *vocabulary* expansion in
`prompt.ts`/`schema.ts`). This plan covers the **register** layer (Stage 3 script text). They are
mostly orthogonal; the **only overlap is `src/script/prompt.ts` and `src/script/schema.ts`**, which
both plans edit:

- Sibling **Phase 4** adds the *audio-tag vocabulary + punctuation-for-rhythm* guidance.
- This plan's **P0** adds the *anti-pattern block, voice asymmetry, tavern room, and imperfection
  budget*.
- They **compose** (different sections of the same system prompt) and are order-independent, but **land
  them as separate jj changes and re-read the file before editing** so the two edits don't collide.
  Both must preserve the **static/cacheable** property of `buildScriptSystemPrompt` (no per-session
  interpolation into the system prompt).

## Non-goals

- No host voice-casting / accent / TTS-settings changes — that's the sibling plan and voice-selection
  work.
- No change to grounding rules, the wiki-excerpt budget, or the "don't reveal undiscovered lore"
  contract (`prompt.ts:72-78`) — tavern texture must not loosen factual grounding.
- No new LLM provider; all generation stays Claude via `@faerrin/llm` (`callTool`).
- The depth phase (per-host rewrite pass + cross-session running-threads memory) is **in scope and
  committed** (per owner: build everything). Its cross-session memory needs a persistence layer that
  doesn't exist yet — building that layer is **work inside the phase**, not a reason to defer it.

## Repo conventions (apply to every phase)

- **VCS is jujutsu, not git.** Use the `jj` skill; never raw `git`. No pre-commit hooks — gates run in CI.
- **Bun everywhere**: `bun test`, `bun run`, `Bun.file`, `` Bun.$ ``. This is a CLI — no Vite/bundler.
- **Per-phase gate** (from `pkg/caster`): `bun run typecheck && bun test`. Whole workspace stays green.
- **Tests are `bun:test`, co-located** (`foo.ts` ↔ `foo.test.ts`). The LLM is injected via the
  `client` option on `generateScript` (`script/index.ts:38`) — a stub `LlmClient` returns canned tool
  output, so register/linter logic is testable **without a live call**.
- **System prompt stays cacheable.** `buildScriptSystemPrompt(hosts)` must remain a pure function of
  `HostConfig` (same hosts → identical string). All P0 prose is *static*. The imperfection-budget
  **counts** are static literals, not per-session values.
- One live generation per phase (`bun run script <id> --force`) is a manual verification step, not CI.

## Key files (verified 2026-06-08, with line anchors)

| File | Role |
|---|---|
| `src/script/hosts.ts` | `DEFAULT_HOSTS` (Bram/Maeve/Pip) — `name` + `persona` per host (12-28). **P0 target** for voice asymmetry. |
| `src/script/prompt.ts` | `buildScriptSystemPrompt` (11-87): roundtable rules (22-44), spoken/TTS rules (46-70), grounding (72-78), title (80-84). `renderBeat` (95-106) emits `BEAT n` ordinal + `Mood:` label. `buildScriptUserContent` (110-143) + `GROUNDING_BUDGET` (108). **P0 target** for anti-patterns/room/budget + `renderBeat` de-structuring. |
| `src/script/schema.ts` | `scriptTool` / `record_script` (5-62): `turns[]` of `{speaker: A\|B\|C, text}` (24-58). **P0** mirrors anti-patterns in the `turns` description; **P1** two-pass replaces this tool with free-text Pass A. |
| `src/script/parse.ts` | `parseScript(sessionId, raw)` → validated `Script`. **P1 linter** reads the parsed turns. |
| `src/script/index.ts` | `generateScript` (33-52) one-shot `callTool`; `loadOrGenerateScript` (70-86) disk-cache seam; `DEFAULT_SCRIPT_MAX_TOKENS=32_000` (18). **P1 two-pass** restructures `generateScript`. |
| `src/script/store.ts` | `scriptPath`→`out/<id>.script.json` (8-10); `writeScript`/`readScript` (13-30). Cache key is just `sessionId` — see **Caching note**. |
| `src/distill/schema.ts` + `src/distill/prompt.ts` | Beat digest upstream. **P1** adds an optional per-beat "table angle" field (degrade gracefully, mirror the existing optional-enrichment pattern). |
| `src/types.ts` | `Beat`, `HostConfig`, `SessionDigest`, `Script` shapes. |

**Architectural facts that shape the plan:**

- **One-shot tool call is the structural cause of the beat-march** (`index.ts:42-48`). P0 fights it with
  constraints; **P1's two-pass is the only change that removes it** (free-text improv → protective
  dressing).
- **`renderBeat` literally prints `BEAT 1/2/3` + `Mood:`** (`prompt.ts:96-102`). The ordinal is an
  explicit "narrate in this order" signal and the mood label is a director's note the model performs
  out loud. Cheapest single content lever to change.
- **`generateScript` already takes an injectable `client`** — the linter and any two-pass logic are
  unit-testable with a stub returning fixed turns; no network in tests.
- **Caching note (must address in P1):** `scriptPath` keys only on `sessionId`. A prompt/persona change
  does **not** invalidate `out/<id>.script.json`; you must `--force` (`index.ts:78`) to regenerate.
  P0 verification therefore always uses `--force`. P1's linter/auto-regenerate must also force past the
  stale artifact. (Optional hardening, P1: fold a short prompt-version hash into the artifact and treat
  a mismatch as a cache miss — so tone changes self-invalidate.)

---

## Phase 1 — Prompt foundation (P0): asymmetry + anti-patterns + room + imperfection budget

**Why first:** text-only edits to `hosts.ts` + `prompt.ts` (+ one `renderBeat` tweak), cheap and fast,
and the diagnosis says the dominant causes are *missing constraints, equal articulacy, and a featureless
void* — exactly what this supplies. It moves the feel on its own **and** is the voice/constraint layer
the Phase 3 two-pass *improv* step reuses — so it's foundational, not a standalone experiment.

### Changes

1. **`src/script/hosts.ts` — asymmetric voice *mechanics* (not adjectives).** Rewrite each `persona` so
   the three differ in *how they talk* and *how they fail*, so no single line could come from one
   omniscient author:
   - **Bram (A)** — *fluent but imprecise.* Long run-on sentences, embellishes, big claims he has to
     walk back; gets names/details wrong and gets corrected; sometimes runs out of sentence and lands
     on "you had to be there."
   - **Maeve (B)** — *precise but terse.* Short, lands the exact word/name, the only one reliably
     right; her power is the deadpan beat and the one-line correction, not the paragraph. (Let her be
     wrong *once* so she isn't an oracle.)
   - **Pip (C)** — *fast but scattered.* Fragments, questions, interrupts himself, free-associates into
     dead-end tangents, rarely completes the dismount; right about *people*, wrong about *facts*.
   - Keep `HostConfig` shape unchanged (still `name` + `persona`); this is pure string content so the
     prompt stays cacheable.

2. **`src/script/prompt.ts` — add four static blocks** to `buildScriptSystemPrompt` (after the existing
   roundtable rules, before the spoken/TTS rules so they don't tangle with the sibling plan's tag
   section):
   - **ANTI-PATTERN block** ("Avoid these podcast tells"): don't make every line a quip; don't narrate
     the recap structure out loud ("first… / moving on to… / before we wrap"); no tidy A-then-B-then-C
     rotation; don't write three equally articulate voices (if you can swap the labels and the lines
     still fit, you've failed); don't march the beats in digest order; don't resolve every disagreement;
     don't explain the inside jokes/callbacks for the listener; don't float in a featureless void; no
     uniform energy; no clean cold-open/sign-off (start mid-talk, end trailing off); no perfect recall.
   - **TAVERN ROOM grounding:** one or two sentences placing them at a specific tavern table — drinks,
     ambient noise, the fire, a barkeep, food — that **intrudes a few times per episode** (a mug goes
     empty, a noise from the bar) and supports a callback late in the episode. Ambient, not constant.
   - **IMPERFECTION BUDGET (counted, not "occasionally"):** across the episode include **at least**:
     several false starts / self-corrections ("the green one — no, the blue one"); ≥1 forgotten-then-
     corrected name; ≥1 disagreement that ends **unresolved**; ≥1 tangent unrelated to any beat that
     just deflates ("…anyway"); ≥1 joke that lands flat / gets ignored; ≥1 thread that gets stepped on
     and is **never finished**. Plus the headline rule: **"At least a third of all lines must fail as
     standalone wit — a fumble, a repair, a dropped thread, a half-sentence, or a beat of dead air. If a
     line would work as a tweet, it's too clean."**
   - **WIT CAP + ENERGY VARIANCE:** most lines are plain talk; let jokes *build across a few turns*
     rather than firing one per line; vary turn length hard — pair long riffs with one-word reactions
     and stretches of clipped back-and-forth; use `[long pause]` where the table would actually go quiet.
   - Phrase imperfection directives as **positive mechanical instructions** ("end ~1 in 4 lines mid-
     thought with '—' and let the next speaker grab the floor"), not bare negations — negations prime
     the thing named and get flattened.

3. **`src/script/prompt.ts` — de-structure `renderBeat` (95-106).** Drop the `BEAT n` ordinal (render
   beats as an unordered pool of "things that happened") and **drop the `Mood:` label** the model
   narrates literally. Keep `summary` / `Why it mattered` / `Worth talking about` / `Involves` as
   discussion fuel. (Optional: shuffle beat order in `buildScriptUserContent` so order can't be
   recited — gate behind a deterministic per-session seed so output stays reproducible for caching/tests.)

4. **`src/script/schema.ts` — light touch.** Update the `turns` array description (26-29) so the tool
   contract echoes "share the floor, vary turn length, plain talk not punchlines" instead of only "avoid
   a fixed A-B-C rotation." (Coordinate with sibling Phase 4's edits to the `text` field.)

### Tests (`prompt.test.ts`, `schema.test.ts`, `hosts` via `script.test.ts`)

- **Cacheability guard:** `buildScriptSystemPrompt(DEFAULT_HOSTS)` is byte-identical across two calls,
  and identical for a fixed custom `HostConfig` (protects prompt caching — same assertion style the
  sibling Phase 4 uses).
- **Content presence:** assert the anti-pattern phrases, the room, the "fail as standalone wit" rule,
  and the counted budget appear in the system prompt; assert the three personas are present and distinct.
- **`renderBeat`:** no `BEAT` / `Mood:` substrings in output; `summary` + enrichment fields still
  render; older digests without enrichment still degrade gracefully (existing behavior preserved).
- **(If shuffling)** beat order is a deterministic function of `sessionId` (same id → same order).

### Gate & manual verification

- `bun run typecheck && bun test` green (whole workspace).
- **Live:** `bun run script <id> --force` on **2-3 real sessions** (note: must `--force` past the cached
  artifact — see Caching note). Read for the podcasty tells: meta-recap phrasing gone, voices
  distinguishable with labels stripped, real fumbles/dropped threads present, room referenced, jokes
  not one-per-line. This is the *qualitative* read; the *quantitative* one is P1's linter.

### Risks / mitigations

- **Over-correction into incoherence** (recap no longer followable, TTS chokes on disfluency) → the
  budget sets *floors*, not a free-for-all; keep grounding rules intact; P1's linter finds the sweet
  spot. If a session reads as mush, dial the "one-third must fail" fraction down.
- **Model ignores constraints under one-shot lookahead** (the core risk the diagnosis names) → this is
  *expected* and is exactly why **two-pass (Phase 3) is committed, not contingent**. P0 establishes the
  voice/constraint layer the two-pass improv step reuses; it is a prerequisite, not a substitute. Don't
  keep piling adjectives into P0 hoping to avoid the structural fix.
- **Edit collision with sibling Phase 4** → land as separate jj changes; re-read `prompt.ts`/`schema.ts`
  before editing; keep the two edits in different prompt sections.

---

## Phase 2 — "Tavern-ness" linter + eval rubric (measurement layer, built before two-pass)

**Why here:** a small, pure, fast phase that turns "tavern-ness" into numbers, so we capture a **P0
baseline** and can then *see* what two-pass (Phase 3) buys. This is **measurement and regression
tooling, not a gate** — two-pass ships regardless of what the numbers say; the linter exists to tune
thresholds, catch regressions, and quantify each later phase. (Linter and two-pass are near-independent;
build the linter first only so the baseline exists.)

### Changes

- New `src/script/lint.ts` (pure, unit-tested) over a parsed `Script`'s turns, computing the
  **mechanically measurable** rubric criteria:
  - **R1** per-speaker vocabulary spread (type-token ratio per host + cross-host vocab distance).
  - **R2** turn-length variance (stdev of words/turn; and per-speaker means should differ — Maeve < Bram).
  - **R3** meta-recap-line ratio (count lines with agenda phrasing: "moving on", "next up", "let's get
    into", "before we wrap", "first/second/finally").
  - **R4** disfluency/repair count (lines ending `—`, "wait— no", self-corrections; corrected-name events).
  - **R5** room/sensory references (drink/noise/fire/barkeep/food lexicon hits).
  - **R6** quip density (share of lines that are standalone punchlines — heuristic + length/punctuation).
  - Plus floor distribution (Gini over turn-count and word-count) and beat-order correlation as
    diagnostics.
- Wire into the CLI as `bun run script <id> --lint` (report) and surface the scores; **target bands**
  per criterion, with the **acceptance bar: ≥13/18 and no measurable criterion at 0** (a single
  mechanical 0 means a podcasty tell survived). Tests assert the metrics on hand-built fixture scripts
  (one obviously podcasty, one obviously tavern) so the thresholds are pinned.
- **Auto-regenerate hook (opt-in):** if metrics fall out of band, regenerate (cheap because the stage is
  cached; must `--force` past the stale artifact). Behind a flag.

**Gate:** `bun run typecheck && bun test` green; run `--lint` on the P0 output of 3-4 real sessions to
**record the baseline** the next phase improves on.

---

## Phase 3 — Two-pass generation (the structural root-cause fix) — *pulled forward, committed*

**Why now (not last):** one-shot generation's global lookahead is *the* cause of the beat-march and
uniform polish (`index.ts:42-48`). P0's constraints fight it; **only this removes it.** It is committed
regardless of P0/linter results — the linter just quantifies the gain. Replaces one-shot
`generateScript` while keeping the `Script` output shape and disk-cache seam unchanged (Stage 4 TTS
untouched).

### Changes

- **Pass A — raw table transcript.** A `callMessages`-style **free-text** generation (NOT the
  `record_script` tool, NOT JSON) instructed as "transcribe what was actually said by people who hadn't
  prepared — keep the ums, restarts, mishearings, answers that arrive two turns late." Free text avoids
  the structured-output "fill the fields cleanly" pull. **Reuses P0's asymmetric personas + anti-pattern
  + imperfection-budget text** as its system prompt. (Confirm `@faerrin/llm` exposes a non-tool
  text-completion path; add a minimal `callMessages` behind `LlmClient` if missing — Anthropic-only, no
  direct SDK.)
- **Pass B — protective dressing.** A second call takes Pass A's transcript and does **only** mechanical
  work: split into `{speaker, text}` turns (the existing `record_script` schema), insert `[audio tags]`,
  fix TTS-hostile spellings. Prompt **forbids** improving the dialogue: "do not make lines wittier, more
  complete, or more articulate; preserve every fumble, repetition, and trailing-off exactly."
- Two calls ≈ 2× script-stage tokens — acceptable and one-time per session (cached). Keep both passes
  selectable via a `--two-pass` flag during rollout so one-shot stays available for A/B, but **two-pass
  becomes the default** once it's landing.
- **Windowed variant (in scope as a follow-on within this phase if the flat two-pass still marches):**
  generate in chunks each seeing only the last ~10 turns + "topics still on the table" — the strongest
  anti-march fix, more plumbing.

### Tests & gate

- With a stub `LlmClient` scripted for both passes: Pass B output validates via `parseScript`; Pass B is
  invoked with the "don't improve" system prompt; the cache seam still short-circuits on a present
  artifact; Pass A uses the P0 persona/anti-pattern prompt.
- `bun run typecheck && bun test` green. **Live:** regenerate 3-4 sessions, run `--lint`, **compare to
  the Phase 2 baseline** (expect R3 meta-recap → 0, R6 quip density down, R2 turn variance up); A/B
  listen after TTS.

### Risks / mitigations

- **`@faerrin/llm` may lack a free-text path** → add a minimal `callMessages` behind `LlmClient`.
- **Over-correction into mush** → keep grounding rules; lean on the linter to find the sweet spot; the
  windowed variant and Pass-B guardrails bound it.

---

## Phase 4 — Per-beat "table angle" (distill enrichment)

- Add an **optional** `tableAngle?: string` to the beat schema (`src/distill/schema.ts`) and ask the
  distill prompt (`src/distill/prompt.ts`) for *what these friends would argue about* — the contested
  call, the dumb decision, the thing one host would defend — seeding friction at the source instead of
  asking the script model to invent it. Feeds both the one-shot and two-pass paths.
- `renderBeat` surfaces `tableAngle` when present; **degrade gracefully** when absent (mirror the
  existing optional-enrichment handling — older cached digests must still render). No forced re-distill.
- **Tests/gate:** `tableAngle` optional end-to-end (present → rendered; absent → graceful);
  `bun run typecheck && bun test` green; `--lint` shows friction metrics (R8) hold or improve.

---

## Phase 5 — Depth (committed)

- **Per-host rewrite pass** — after a draft (one-shot or two-pass), a targeted per-host pass pushing each
  voice further from the mean (Bram messier, Maeve terser, Pip barbier) to counter regression-to-one-
  voice. Highest voice separation; verify against R1/R7.
- **Cross-session running-threads / inside-jokes memory** — persist callbacks/grudges/old predictions so
  references are grounded, not fabricated (serves the "shared history" pillar). **Requires building a
  persistence layer** (none exists today): design the store (where it lives, schema, how distill/script
  read+write it), then wire it into the script prompt. This layer is the phase's main lift — scope it as
  its own design step at the start of Phase 5.
- **Tests/gate:** per-host pass and memory store unit-tested behind injected seams; `--lint` confirms R1
  (vocab spread) and R8 (friction) gains; `bun run typecheck && bun test` green.

---

## Eval rubric (acceptance gate, used from P1a on)

Used from **Phase 2** on. Score each **0-2** (0 = podcasty/absent, 1 = weak, 2 = clearly present).
**Target ≥13/18, and no mechanically-measurable (M) criterion at 0.** M = wire into `lint.ts`;
J = human judgment.

| # | Criterion | M/J |
|---|---|---|
| R1 | Per-speaker vocabulary spread (distinct lexicons) | M |
| R2 | Turn-length variance (+ per-speaker means differ) | M |
| R3 | Meta-recap-line ratio (agenda phrasing → ~0) | M |
| R4 | Disfluency / repair count (incl. a corrected name) | M |
| R5 | Room / sensory references (ambient, not constant) | M |
| R6 | Quip density (jokes clustered, a minority of lines) | M |
| R7 | Voice-attribution blind test (labels stripped, host guessable) | J |
| R8 | Unresolved friction (≥2 disagreements that don't tidy up) | J |
| R9 | Coverage-vs-conversation (out-of-order, a skipped/glanced beat, a non-beat tangent) | J |

For R7-R9, a **blind A/B of old-pipeline vs new-pipeline** output via a separate LLM-judge call (judge
prompt kept distinct from the generator) is more stable than absolute scoring.

---

## Suggested sequencing

**All five phases ship — this is build order, not a go/no-go funnel:**

**Phase 1 (prompt foundation) → Phase 2 (linter, capture baseline) → Phase 3 (two-pass, the structural
fix) → Phase 4 (table-angle) → Phase 5 (depth).**

- **Phase 1** is the foundation: it improves the one-shot output *and* supplies the persona/constraint
  prompt the Phase 3 improv step reuses. Not a standalone experiment to be judged before continuing.
- **Phase 2 before Phase 3** only to **capture the baseline** the two-pass gain is measured against —
  the linter is tuning/regression tooling, **not a gate**. (Phases 2 and 3 are near-independent and may
  be built in parallel; if so, baseline the linter on Phase 1 output before reading Phase 3 deltas.)
- **Phase 3 (two-pass) is committed and deliberately early** — it removes the global-lookahead root
  cause that prompt constraints can only fight. Default to two-pass once it lands; keep `--two-pass`/one-
  shot selectable during rollout for clean A/B.
- **Phases 4-5** deepen friction-at-source and voice asymmetry / shared history; Phase 5's cross-session
  memory begins with designing the persistence layer it needs.
- Each phase is its own **jj change**, green under `bun run typecheck && bun test`; workspace stays green.
- **Coordinate `prompt.ts`/`schema.ts` edits with the sibling naturalness plan's Phase 4** — separate
  changes, different prompt sections, re-read before editing, preserve cacheability.

---

*Plan authored via `/octo:plan` (Claude-only team mode per repo `CLAUDE.md`; external-provider banner
skipped by design — codex/gemini/opencode all absent, as intended). Saved project-local per repo
convention instead of `.claude/session-plan.md`. Companion to
`2026-06-07-elevenlabs-naturalness.md` (acoustic layer).*
