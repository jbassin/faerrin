# Caster — ElevenLabs Voice Naturalness (staged plan)

**Created:** 2026-06-07
**Package:** `@faerrin/caster` (`pkg/caster`)
**Stage touched:** Stage 4 (`tts`) primarily; Stage 5 (`assemble`) in Phase 2.
**Source of analysis:** `/octo:discover` session 2026-06-07 (codebase audit + ElevenLabs docs research).

## Goal

Make caster's generated podcast voices feel more natural and consistent by turning the
ElevenLabs knobs we currently leave on defaults, and by removing an avoidable quality loss.
Four independently-shippable phases:

1. **Expressiveness control** — expose `settings.stability` + `seed` on the Text-to-Dialogue call.
2. **Quality** — stop double lossy MP3 encoding (lossless intermediate, single final encode).
3. **Pronunciation** — **in-repo** inline IPA for invented Faerrin/Pathfinder names (no dashboard).
4. **Prose direction** — enrich the script LLM prompt: punctuation for natural rhythm + the full v3
   audio-tag vocabulary, including overlap/turn-timing tags.

## Non-goals

- No accent/voice-casting changes (separate, voice-selection work).
- No request stitching — **v3 / Text-to-Dialogue does not support it**; do not attempt.
- No account-side / dashboard-configured pronunciation dictionaries — pronunciation data lives **in the
  repo** (Phase 3) so it's version-controlled and reviewable.
- Phases are decoupled; each ships green on its own. Numeric order is a suggestion, not a hard
  dependency (Phase 4 is pure prompt text and can land anytime; see Suggested sequencing).

## Repo conventions (apply to every phase)

- **VCS is jujutsu, not git.** Use the `jj` skill; never raw `git`. No pre-commit hooks — gates run in CI.
- **Bun everywhere**: `bun test`, `bun run`, `Bun.file`, `` Bun.$ ``. This is a CLI — no Vite/bundler.
- **Per-phase gate** (run from `pkg/caster`): `bun run typecheck && bun test`. Whole workspace must stay green.
- **Tests are `bun:test`, co-located** (`foo.ts` ↔ `foo.test.ts`). The network is injected via
  `fetcher` / `dialogueFetcher` on `ElevenLabsTTSProvider` — unit tests assert on the **request body**
  without any live call. Each phase adds body-shape assertions through that seam.
- **LLM-free**: none of these phases call `@faerrin/llm`. Stage 4/5 only.
- One live smoke test per phase against a real key is a manual verification step, not a CI test.

## Key files (verified 2026-06-07, with line anchors)

| File | Role |
|---|---|
| `src/tts/elevenlabs.ts` | `liveFetch` (51-64), `liveDialogueFetch` (67-85), `ElevenLabsOptions` (87-98), `ElevenLabsTTSProvider` (107-153). `OUTPUT_FORMAT="mp3_44100_128"`, `BYTES_PER_SECOND=16000` (23-24). Model default `eleven_v3` (118). |
| `src/tts/provider.ts` | `TTSProvider`, `SynthesisRequest/Result`, `DialogueRequest`. The `format` field + `synthesizeDialogue?`. |
| `src/tts/index.ts` | `synthesizeScript` writes `out/<id>/NNN.<provider.format>`; manifest records `format` (57-65). |
| `src/tts/edge.ts` | `estimateMp3DurationMs(byteLength, bytesPerSecond)` — the byte→duration estimator. |
| `src/tts/dialogue.ts` | `chunkTurns`, `DEFAULT_DIALOGUE_BUDGET=1800`. |
| `src/tts/tags.ts` | `renderDelivery`, `stripAudioTags`. |
| `src/cli.ts` | flag parsing (~79-103): `--provider`, `--model`, `--force`; provider constructed with `DEFAULT_ELEVENLABS_VOICES`. |
| `src/assemble/ffmpeg.ts` | `probeClip` (ffprobe, 13-21), `codecArgs` handles `mp3|wav` (24-26), `makeSilence`/`fadeClip` handle both, `concatLoudnorm` does the **final** `libmp3lame -b:a 128k` encode (65-67). |
| `src/assemble/index.ts` | `prepareDialogue`/`prepareTurns`; already calls `probeClip` on clip[0] and threads `manifest.format` into every ffmpeg helper. |

**Architectural facts that shape the plan:**

- Stage 5 is **already format-agnostic** (`mp3` vs `wav`): `provider.format` flows into the manifest,
  `probeClip` reads real stream params off disk, and `makeSilence`/`fadeClip`/`codecArgs` already branch
  on `mp3|wav`. The **final** episode is always a single MP3 via `concatLoudnorm`. This is why Phase 2
  is mostly an ElevenLabs-provider change, not a Stage 5 rewrite.
- `clip.durationMs` is **manifest metadata**; assembly stitches via concat + silence and does **not**
  use `durationMs` for timing. So a duration-estimate change is low-blast-radius (affects reported
  numbers/tests, not the rendered audio).
- `pronunciations.json` **does not exist** and nothing reads it (the caster `CLAUDE.md` mention is
  aspirational). Phase 3 is greenfield.

---

## Phase 1 — Expose `settings.stability` + `seed`

**Why:** On `eleven_v3` the single biggest naturalness/expressiveness lever is the stability mode
(Creative / Natural / Robust); lower stability = broader emotional range and stronger audio-tag
response, higher = flatter/monotone. We send neither `settings` nor `seed`, so we ride the default
(~Natural/0.5) with no control, and every re-render is a fresh non-reproducible take.

**API shape (Text-to-Dialogue `POST /v1/text-to-dialogue`):** body accepts
`settings: { stability: number }` and `seed: integer (0–4294967295)`, alongside the existing
`inputs` + `model_id`. (Regular `/v1/text-to-speech` takes the same via `voice_settings`/`seed`;
include it there too for the non-v3 path, cheaply.)

### Changes

1. **`src/tts/elevenlabs.ts`**
   - Extend `ElevenLabsDialogueRequest` and `ElevenLabsRequest` with optional `stability?: number`
     and `seed?: number`.
   - In `liveDialogueFetch`, add to the body when defined:
     `settings: { stability }` (omit the key entirely when undefined — don't send `null`), and `seed`.
   - In `liveFetch`, add `voice_settings: { stability }` and `seed` likewise (non-v3 path).
   - Add `stability?: number` and `seed?: number` to `ElevenLabsOptions`; store on the provider; pass
     through in `synthesize` / `synthesizeDialogue`.
   - **Stability input mapping:** accept a friendly enum at the CLI and map to numeric here. Proposed:
     `creative → 0.0`, `natural → 0.5`, `robust → 1.0`; also accept a raw `0–1` float. Keep the
     mapping in one small exported helper (`resolveStability(input): number`) so it's unit-testable.
     ⚠️ **Verify the v3 numeric contract** in the live smoke test (see Open questions) — if v3 wants a
     discrete value rather than a continuous 0–1, adjust the mapping/default only (no structural change).

2. **`src/cli.ts`**
   - Parse `--stability=<creative|natural|robust|0..1>` and `--seed=<int|random>`.
   - Default `seed`: **derive deterministically from `sessionId`** (stable hash → uint32) so re-runs and
     `--force` reproduce the same take; `--seed=<n>` overrides; `--seed=random` opts out.
   - **Default `stability` = `0.3`** — leans expressive (toward Creative=0.0) without going all the way,
     so it's responsive to audio tags but less prone to v3's hallucination/drift at full Creative. This
     is a deliberate audible change vs today's API default (~0.5). `--stability=natural` (0.5) restores
     the old feel; `--stability=robust` flattens it.
   - Thread both into `new ElevenLabsTTSProvider({ ... })`.

### Tests (`src/tts/elevenlabs.test.ts`, `src/cli` arg-parse test)

- At the **provider** level, `settings.stability`/`seed` appear in the body **only when the option is
  set**, and undefined keys are omitted (not `null`) — assert via injected `dialogueFetcher`/`fetcher`
  capturing the request.
- At the **CLI** level, the defaults apply: body carries `settings.stability = 0.3` and a derived
  `seed` with no flags; `--stability=natural` → 0.5, `--stability=robust` → 1.0; explicit `--seed=<n>`
  overrides; `--seed=random` is in-range.
- `resolveStability`: `"creative"|"natural"|"robust"` → 0/0.5/1; numeric passthrough; invalid → throws.
- Seed derivation is deterministic for a fixed `sessionId`; `--seed=random` yields a uint32 in range.

### Gate & manual verification

- `bun run typecheck && bun test` green.
- **Live smoke:** `bun run tts <id> --stability=creative` and `--stability=robust` on a short script;
  confirm 2xx and audibly different expressiveness; confirm the body the API accepts matches the
  numeric mapping (capture once with a logging fetch or proxy).

### Risks / mitigations

- *v3 stability semantics differ from the numeric guess* → isolated in `resolveStability`; fix mapping only.
- *Sending `null` vs omitting* → always **omit** undefined keys to avoid 422s.

---

## Phase 2 — Stop double lossy MP3 encoding

**Why:** Today each clip is fetched as `mp3_44100_128`, then Stage 5 re-encodes the concatenation
through `libmp3lame -b:a 128k` (`concatLoudnorm`). That's two generations of MP3 artifacts on every
second of audio. Eliminate the **first** lossy encode by fetching a lossless intermediate; keep the
single final MP3 encode.

**Chosen approach: lossless PCM intermediate wrapped as WAV.** ElevenLabs `output_format=pcm_44100`
returns **headerless raw PCM** (s16le, mono, 44.1 kHz). Stage 5's ffmpeg path needs a real container
(`probeClip`/ffprobe can't read raw PCM without format hints), and the helpers already speak `wav`, so
wrap the PCM in a 44-byte WAV header before writing `NNN.wav`.

> Lower-effort fallback (if PCM/WAV proves fiddly): fetch `mp3_44100_192` and keep `format="mp3"`.
> This *reduces* but does not *eliminate* the first lossy encode. Only the `output_format` and
> `BYTES_PER_SECOND` (→ 24000) change. Document the trade-off; prefer the PCM path.

### Changes

1. **`src/tts/elevenlabs.ts`**
   - Add a small `pcmToWav(pcm: Uint8Array, { sampleRate, channels, bitsPerSample }): Uint8Array`
     helper (canonical 44-byte RIFF/WAVE header + PCM body). Pure function, fully unit-testable.
   - Default `OUTPUT_FORMAT = "pcm_44100"`; set `provider.format = "wav"`; wrap fetched bytes via
     `pcmToWav` before returning from both `liveFetch` and `liveDialogueFetch`.
   - **Duration:** compute exactly from PCM size — `bytes / (sampleRate * channels * bytesPerSample) * 1000`
     — instead of the mp3 byte-rate estimate. (More accurate than today.) Add
     `pcmDurationMs(byteLength, params)` next to / in place of the mp3 estimator usage for this provider.
   - Keep `outputFormat` overridable so the mp3 fallback (and tests) can force `mp3_*` + `format="mp3"`.
     The provider should derive `format` from the requested `output_format` codec prefix
     (`pcm_* → wav`, `mp3_* → mp3`) rather than hardcoding.

2. **Stage 5 — expected to be no-op, verify only.** `assemble/index.ts` already threads
   `manifest.format` ("wav") through `probeClip` / `makeSilence` / `fadeClip`, and `codecArgs`
   already emits `pcm_s16le` for wav; `concatLoudnorm` still produces the single final MP3. Confirm the
   `.wav` clips concat + loudnorm cleanly and the episode is byte-reasonable.

3. **Disk/cache:** clips become `NNN.wav` (larger). The manifest already records `format`, and
   `clipsPresent` checks the recorded paths, so caching still works. Note the size increase in the
   caster `CLAUDE.md` / `.env.example` if worth it.

### Tests

- `pcmToWav`: header bytes correct (RIFF/`WAVE`/`fmt `/`data`, sizes, sample rate, channels, 16-bit);
  round-trips length; ffprobe (if available in test env) reads it — otherwise assert header fields directly.
- `pcmDurationMs`: exact for known byte lengths.
- Provider `format` derivation: `pcm_44100 → "wav"`, `mp3_44100_192 → "mp3"`.
- Existing dialogue/turn tests updated for `format: "wav"` and the new duration path (Mock provider
  unaffected — it owns its own format).

### Gate & manual verification

- `bun run typecheck && bun test` green.
- **Live smoke:** full `tts` + `assemble` on a short session; `ffprobe` the per-clip `.wav` (PCM s16le,
  44.1k) and the final `episode.mp3`; A/B listen vs an mp3-intermediate render for artifact reduction.

### Risks / mitigations

- *Raw-PCM channel count / sample rate mismatch* → derive header params from the requested
  `output_format` string; assert in tests; ffprobe smoke-check.
- *Bigger temp footprint* → acceptable for quality; clips are cleaned by existing `rm` of the clips dir
  on re-synth and the `work` dir on assemble.
- *Mock/Edge providers* → untouched; they set their own `format` and don't use ElevenLabs duration math.

---

## Phase 3 — In-repo inline IPA for Faerrin/Pathfinder names

**Why:** Invented proper nouns (deities, places, the setting name itself) are the most audible "AI tell"
in fantasy narration. v3 honors **inline IPA wrapped in slashes** (e.g. `/ˈfɛrɪn/`) directly in the
text (~80–90% reliable per ElevenLabs), which needs **no account-side dictionary and no dashboard** —
the pronunciation data stays version-controlled in the repo, which is the stated preference.

**Greenfield:** there is no `pronunciations.json` and no loader today. This phase creates the in-repo
lexicon and a deterministic render-time substitution. No network calls, no uploads, no dictionary IDs.

### Approach

- **Data — in repo:** create `pkg/caster/content/pronunciations.json`: a map of term → IPA, e.g.
  `{ "Faerrin": "ˈfɛrɪn", "Charon": "ˈkɛərɒn" }`. Authoring is IPA-only (the lever v3 actually reads);
  comments/notes can live alongside in the JSON if useful. Checked in and reviewable.
- **Apply at render time (text-level, deterministic):** in `src/tts/tags.ts` (alongside
  `renderDelivery`), add a `applyPronunciations(text, lexicon)` step that wraps the **first** occurrence
  of each known term per turn in `/IPA/`. Run it only on the v3 path (where slash-IPA is supported);
  on non-v3 it's a no-op (the slashes would be read literally). Order it so it composes cleanly with the
  existing audio-tag rendering and doesn't rewrite text inside an existing `[tag]`.
- **Wire into Stage 4:** load the lexicon once in `synthesizeScript`/the provider setup and pass it to
  the render step used by `synthesizeDialogueChunks` (and `synthesizePerTurn` if v3). Cache the parsed
  lexicon; tolerate a missing file (empty lexicon → no-op).
- **No `elevenlabs.ts` body change** — pronunciation is encoded in the text itself, so the existing
  `inputs[].text` carries it. (This is the win of the inline route: zero API-surface change.)

> Rejected alternative: account-side `.pls` **pronunciation dictionaries** referenced via
> `pronunciation_dictionary_locators`. More deterministic and model-agnostic, but requires uploading to
> and versioning a dictionary in the ElevenLabs account/dashboard — explicitly **not wanted**; we keep
> pronunciation data in the repo. (If v3 inline-IPA reliability disappoints in the smoke test, this is
> the fallback to reconsider — it would add `src/tts/pronunciation.ts` for upload+cache and a
> `pronunciation_dictionary_locators` body field.)

### Changes

1. `pkg/caster/content/pronunciations.json` — term → IPA map (checked in).
2. `src/tts/pronunciation.ts` (small): `loadLexicon(path)` + `applyPronunciations(text, lexicon)`,
   pure and unit-testable. (Or co-locate `applyPronunciations` in `tags.ts` next to `renderDelivery`.)
3. `src/tts/index.ts`: load lexicon once; thread into the v3 render path; missing file → empty lexicon.
4. `src/cli.ts`: `--no-pronunciation` escape hatch (skips the substitution).

### Tests

- `applyPronunciations`: wraps known terms in `/IPA/`; first-occurrence only; case handling defined;
  leaves unknown words untouched; **does not** edit text inside existing `[tags]`; whitespace preserved.
- v3 vs non-v3: substitution applied on v3, skipped on non-v3 (slashes never reach a non-v3 voice).
- Missing/empty `pronunciations.json` → no-op (no throw).
- `--no-pronunciation` disables it.

### Gate & manual verification

- `bun run typecheck && bun test` green.
- **Live smoke:** seed the lexicon with 3–5 known offenders (setting/deity names), render a line using
  them with and without `--no-pronunciation`, confirm the IPA is honored audibly.

### Risks / open questions

- *Inline IPA reliability on v3 is ~80–90%, voice-dependent* → smoke-test the actual host voices; if a
  term won't take, refine its IPA or fall back to the rejected `.pls` route for that subset.
- *IPA authoring burden* → start with a handful of high-frequency offenders; grow the lexicon over time.
- *Interaction with Phase 4 tags* → ensure `applyPronunciations` and audio-tag rendering compose in a
  defined order and don't corrupt each other (covered by the "inside `[tags]`" test above).

---

## Phase 4 — Enrich the script-generation prompt (punctuation + full v3 tag vocabulary)

**Why:** v3 reads punctuation for prosody (ellipses `…` add hesitation/weight, em-dashes add rhythm,
CAPS add emphasis) and supports a much larger audio-tag vocabulary than the prompt currently advertises
— including **overlap / turn-timing** tags (`[starting to speak]`, `[jumping in]`, `[overlapping]`,
`[interrupts]`) that directly serve the "they interrupt and finish each other's thoughts" chemistry the
prompt already asks for. Teaching the LLM these levers makes the *text it writes* more natural, with no
API change. Pure prompt/schema edit — the cheapest, lowest-risk naturalness win.

**Files:** `src/script/prompt.ts` (the "read aloud" guidance, lines 46-59) and `src/script/schema.ts`
(the `turns[].text` description, lines 43-50). Both describe tags to the model and must stay
consistent.

### Changes

1. **`src/script/prompt.ts` — add a punctuation-for-rhythm bullet** to the "Write every line as SPOKEN
   text" list, e.g.: use ellipses `…` for hesitation, trailing-off, or weight; em-dashes for an abrupt
   cut or rhythm change; ALL CAPS sparingly on a single word for emphasis. (Keep the existing
   "spell out numbers / no markdown / no stage directions" rules — punctuation here means *speakable*
   punctuation, not symbols read aloud.)
2. **`src/script/prompt.ts` — expand the audio-tag bullet** into grouped categories and state that tags
   are natural-language delivery directions (not a fixed list), still used sparingly:
   - *Emotions:* `[warm]`, `[excited]`, `[nervous]`, `[sad]`, `[awe]`, `[deadpan]`, `[sarcastic]`.
   - *Reactions / non-verbal:* `[laughs]`, `[sighs]`, `[gasps]`, `[clears throat]`, `[whispers]`.
   - *Delivery / pacing:* `[pause]`, `[rushed]`, `[slows down]`, `[emphasized]`, `[drawn out]`.
   - *Overlap / turn-timing* (new): `[starting to speak]`, `[jumping in]`, `[overlapping]`,
     `[interrupts]`, `[continues after a beat]` — for when a host cuts in or talks over another.
   - Reiterate: only tags that suit each host's voice; a few per exchange; lead a line or drop mid-line.
3. **`src/script/schema.ts` — mirror the expanded vocabulary** in the `text` field description so the
   tool schema and system prompt agree (the model sees both).
4. **Keep the prompt STATIC per host config** (no per-session data) so it remains a cacheable prefix —
   the existing caching property in the `buildScriptSystemPrompt` doc comment must hold.

### Tests

- `prompt.test.ts` / `schema.test.ts` (or existing script tests): assert the new vocabulary strings and
  the punctuation guidance are present; assert the prompt is still static for a fixed `HostConfig`
  (same input → identical string) to protect prompt caching.
- No behavioral runtime change to assert beyond prompt content; the downstream tag handling already
  exists (`renderDelivery`/`stripAudioTags`) and overlap tags are just more bracketed tags it passes
  through on v3 / strips on non-v3.

### Gate & manual verification

- `bun run typecheck && bun test` green.
- **Live smoke:** regenerate a `script` for a short session; eyeball that the LLM uses ellipses/dashes
  and occasional overlap tags naturally (not over-stuffed); render via `tts` and listen for whether v3
  actually honors the overlap/turn-timing cues with the chosen voices.

### Risks / mitigations

- *Tag over-use* — more vocabulary can tempt the model to over-tag; keep the "sparingly, only where it
  earns it" instruction prominent and review a sample episode.
- *Overlap-tag acoustic reliability in Text-to-Dialogue is uncertain* — overlaps may render as timing
  cues rather than true acoustic overlap, and reliability is voice-dependent; treat as best-effort and
  confirm by ear (see Open questions).
- *Prompt-cache regression* — adding static text is fine; do not introduce per-session interpolation
  into the system prompt.

---

## Open questions (resolve via live smoke, not blocking the plan)

1. Exact v3 `settings.stability` numeric contract (continuous 0–1 vs discrete). → Phase 1 mapping +
   the chosen `0.3` default only; structure unaffected.
2. Does the **Text-to-Dialogue** endpoint accept `seed` identically to `/text-to-speech`? Docs say yes;
   confirm with one request capture in Phase 1's smoke test.
3. **v3 inline-IPA reliability** on the actual host voices (Phase 3) — confirm by ear; refine IPA or, for
   stubborn terms only, reconsider the rejected `.pls` route.
4. **Overlap / turn-timing tag** behavior in Text-to-Dialogue (Phase 4) — does v3 render true acoustic
   overlap or just timing cues? Confirm by ear; keep usage sparing regardless.

## Suggested sequencing

Default order **1 → 2 → 3 → 4**, each its own jj change, each green under `bun run typecheck && bun test`
before the next. Notes on coupling:

- **Phase 1** establishes the "omit-when-undefined" body-building pattern in `elevenlabs.ts` (reused by
  the seed/settings keys).
- **Phase 2** is the only one touching Stage 5 / `output_format`; isolate it so the audio-quality A/B is
  clean.
- **Phase 3** is text-render-only (`tags.ts`/`index.ts`), **no** `elevenlabs.ts` body change.
- **Phase 4** is pure prompt/schema text with no API surface — it can land **anytime** (even first) and
  is the cheapest, lowest-risk win; sequenced last only so live audio comparisons aren't confounded by
  changing script text mid-stream.

---

*Plan authored via `/octo:plan` (Claude-only team mode per repo `CLAUDE.md`; provider banner skipped by
design). Saved project-local per repo convention instead of `.claude/session-plan.md`.*
