# Caster — Discovery & Definition

> AI podcast generator: turns Pathfinder 2e homebrew campaign play-session transcripts
> into two-host, podcast-style audio recaps, grounded against the setting wiki.
>
> Produced via the Double Diamond Discover → Define phases. Claude-only research
> (no external LLM providers were installed for multi-LLM orchestration).

---

## Part 1 — Discovery

### 1.1 The data we actually have

| Aspect | Reality | Implication |
|---|---|---|
| **Transcripts** | 39 files, `NNN.arc-slug.YYYY-M-D.txt`. Lines are `000123\tSpeaker: text  `. ~3,600 lines / ~230 KB / **~50–60K tokens each**. | Fits a 200K+ context window one-at-a-time, not all 39 at once. Per-session is the natural unit. |
| **Speakers** | Diarized labels are always **character names** (`Argyle`, `Foral`, `Scrazzy`, `Ozzie`, …) or **`Gamemaster`** — never player real names (verified: no `Josh`/`Jorge`/`Mike`/`Noah`/`Tanner` label appears anywhere). Machine ASR → no reliable punctuation, run-ons, errors. | Speaker map resolves `(arc, characterName) → player/role`. Tolerate noisy ASR and unmatched labels. |
| **Speaker map** | Provided at `content/shibboleth.json`, keyed `arcTitle → isMain + roles(player → [{name, desc}])`. Captures multi-character players (Jorge = Argyle **and** Arctos) and per-arc GM (arc 106's GM is Tanner, not Josh). Audited against all 39 files — accurate. | Must be **inverted** to `(arc, characterName) → {player, role, desc}` for lookup, and arc keys (prose titles) **slug-resolved** to filenames. |
| **Signal/noise** | Heavy **off-topic table talk** interleaved with actual play. | The filtering/segmentation step is the highest-leverage part of the pipeline. |
| **Arcs** | `000` = main campaign (*Through a Song Darkly*, ~30 sessions); `101–106` = side arcs (3–4 sessions each). | Natural grouping for episodes. |
| **Wiki** | 93 Obsidian/Quartz markdown files with frontmatter, `[[wikilinks]]`, `[[Path/index\|Alias]]`, and embedded `<pre>`/HTML. Folders: Geography, Org, Divinity, Phenomena, Rules, Timeline. | Setting bible for grounding names/factions. Wikilinks form a graph usable for retrieval. HTML/frontmatter must be stripped for LLM context. |

**Key insight:** This is a *transcript-summarization-to-dialogue* problem with a *lore-grounding* side channel — distill the story out of a noisy table recording, then re-narrate it as two hosts.

### 1.2 Pipeline architecture

```
content/transcripts/105.*.txt ─┐
                                ├─▶ [1] INGEST ──▶ normalized turns (.json)
content/wiki/**/*.md ──────────┘                        │
                                                         ▼
                                            [2] DISTILL  ──▶ session "story beats"
                                            (filter table-talk,        (.json)
                                             segment, summarize)        │
                                  wiki retrieval ───────────────────────┤
                                                                        ▼
                                            [3] SCRIPT  ──▶ two-host dialogue
                                            (LLM, structured              (.json)
                                             speaker-tagged turns)        │
                                                                        ▼
                                            [4] SYNTHESIZE ──▶ per-turn audio clips
                                            (TTS, voice per host)         │
                                                                        ▼
                                            [5] ASSEMBLE ──▶ episode.mp3 + transcript.md
```

**Critical design choice:** persist artifacts to disk between every stage so each stage
re-runs independently and expensive LLM/TTS calls are cached.

### 1.3 Stage findings

- **Stage 1 Ingest** — regex parse `^(\d{6})\t([^:]+):\s(.*)$` per transcript line; load `content/shibboleth.json` and **invert** it to `(arc, characterName) → {player, role, desc}` (role = gm when `name === "Gamemaster"`, else player); **slug-resolve** arc titles (`"Observatory, Slipped"` → `observatory-slipped`: lowercase, drop commas/apostrophes, spaces→hyphens) to match `NNN.arc-slug.*` filenames; keep lookups arc-scoped (e.g. `Archie` = Tanner in both 101 and 104 — no global collision); treat valid-but-unmapped labels gracefully (players drop in/out across sessions). Strip wiki frontmatter (`gray-matter`) + embedded HTML; parse `[[wikilinks]]` into a graph (cheap retrieval index, no vector DB at this scale). Bun-native IO (`Bun.Glob`, `Bun.file`).
- **Stage 2 Distill** — start with a **single long-context pass** (whole ~55K-token transcript → discard table talk + emit ordered story beats). Map-reduce/chunking deferred until needed.
- **Stage 3 Script** — define two personas; emit **structured** `{speaker, text, emotion}` turns via tool-use/JSON schema; resolve referenced names against the wikilink graph and pull cleaned wiki text for grounding; use prompt caching on static persona prompt. Reference (do not adopt — it's Python): [Podcastfy](https://github.com/souzatharsis/podcastfy), the open-source NotebookLM-podcast clone — mine its prompt/persona structure.
- **Stage 4 TTS** — behind a `TTSProvider` interface. 2026 ecosystem:

  | Provider | Multi-speaker | Quality | ~Cost | Fit |
  |---|---|---|---|---|
  | ElevenLabs v3 Text-to-Dialogue | ✅ native, audio tags | benchmark | tiered ($22→$330/mo) | best quality |
  | Google Gemini 2.5/3.x Flash TTS | ✅ native | top-tier short-form | ~$0.91/hr batch | best value |
  | OpenAI `gpt-4o-mini-tts` | ⚠️ single-voice, you stitch | high, steerable | ~$0.015/min | cheap/simple |
  | Edge TTS | per-turn single-voice | decent | free | dev/iteration |

- **Stage 5 Assemble** — `ffmpeg` via `Bun.$` (concat demuxer + `loudnorm` EBU R128); native dialogue APIs may return one file (minimal assembly).

### 1.4 Bun/TS stack
`Bun.Glob`/`Bun.file`/`Bun.write`/`Bun.$` (no fs/execa); `@anthropic-ai/sdk` with tool-use + prompt caching; `gray-matter`/`remark` for wiki cleanup; `bun:sqlite` for content-hash memoization (post-MVP); CLI first, `Bun.serve()` UI later; `.env` auto-loaded.

### 1.5 Sources
- [ElevenLabs Text-to-Speech / Dialogue](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)
- [ElevenLabs pricing 2026](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs)
- [TTS API pricing 2026 (Gemini/OpenAI/Voxtral)](https://tokencost.app/blog/tts-api-pricing-2026)
- [OpenAI gpt-4o-mini-tts](https://platform.openai.com/docs/models/gpt-4o-mini-tts)
- [Voice generation models compared 2026](https://sureprompts.com/blog/voice-generation-models-compared-2026)
- [Podcastfy (open-source NotebookLM podcast clone)](https://github.com/souzatharsis/podcastfy)

---

## Part 2 — Definition (MVP)

### 2.1 Locked decisions
| Decision | Choice |
|---|---|
| Episode unit | **One session = one episode** (39 episodes; single-file distillation) |
| Hosts | **Hybrid**: Host A = enthusiast recapper, Host B = lore-keeper who cross-references the wiki |
| Canon scope | **Wiki for grounding only** — correct names/factions, don't volunteer undiscovered plot |
| Budget | **Cheap/free first** — Edge TTS + cost-conscious models in dev; provider swappable |

### 2.2 MVP goal
`bun run generate content/transcripts/105.observatory-slipped.2026-4-27.txt` →
`out/105.../episode.mp3` + `transcript.md`: a two-host recap with lore terms grounded against the wiki.

### 2.3 Scope
**In:** Stages 1–5; speaker resolution from `content/shibboleth.json` (inverted + slug-resolved); cleaned wiki + `[[wikilink]]` graph for name-grounding; disk artifacts between stages; CLI entry point; Edge/free TTS behind an interface.

**Out (deferred):** arc-level episodes, map-reduce distillation, web UI, `bun:sqlite` caching, music/intro-outro, premium TTS (ElevenLabs/Gemini).

### 2.4 Stage contracts

```ts
// Stage 1 → 2
type Turn = {
  line: number;
  speaker: string;            // raw diarized label (a character name or "Gamemaster")
  text: string;
  player?: string;            // resolved via speaker map (undefined if unmapped)
  role?: "gm" | "player";
};
type Session = { id: string; arc: string; arcTitle: string; date: string; turns: Turn[] };

// Source of truth: content/shibboleth.json — arcTitle → { isMain, roles }
type Shibboleth = Record<string, {        // key = arc prose title, e.g. "Observatory, Slipped"
  isMain: boolean;
  roles: Record<string, Array<{ name: string; desc: string[] }>>;  // player → characters
}>;
// Derived at load time (inverted + arc-scoped) for line lookup:
type ResolvedSpeaker = { player: string; role: "gm" | "player"; desc: string[] };
type SpeakerIndex = Map<string /* arcSlug */, Map<string /* characterName */, ResolvedSpeaker>>;
// arcSlug = slugify(arcTitle): lowercase, drop commas/apostrophes, spaces→hyphens.

// Stage 2 → 3   (distillation output — the make-or-break artifact)
type Beat = {
  order: number;
  summary: string;            // what happened, in-world
  characters: string[];       // resolved against wiki where possible
  locations: string[];
  wikiRefs: string[];         // file paths to pull as grounding context
};
type SessionDigest = { sessionId: string; synopsis: string; beats: Beat[]; discarded: string[] /* table-talk samples */ };
// Implemented in src/distill/. The LLM call sits behind an `LlmClient` interface
// (AnthropicClient: forced tool_choice, streaming, cache_control on the static
// system prompt). Forced tool_choice precludes adaptive thinking — deliberate
// tradeoff for guaranteed structured output. Run: `bun run distill <id>`.

// Stage 3 → 4
type ScriptTurn = { speaker: "A" | "B"; text: string; emotion?: string };
type Script = { sessionId: string; turns: ScriptTurn[] };

// Stage 4 → 5
interface TTSProvider { synthesize(turns: ScriptTurn[], voices: Record<"A"|"B", string>): Promise<Clip[]>; }
type Clip = { turn: number; path: string };

// Stage 5 → output: episode.mp3 + transcript.md
```

### 2.5 Acceptance criteria
1. **Stage 1:** parses all 39 files without error; `Turn[]` count == non-empty lines; every arc's `shibboleth.json` title slug-resolves to its filenames; known character labels resolve to `{player, role}`, unmapped labels pass through with `player`/`role` undefined (no crash).
2. **Stage 2 (gate):** for `105`, beats are a coherent in-game story and `discarded` clearly contains table talk. *If a reader can't follow the plot from the beats, iterate the prompt before building downstream.*
3. **Stage 3:** valid `ScriptTurn[]` JSON; lore terms match wiki spelling; no fabricated undiscovered plot.
4. **Stage 4/5:** playable `episode.mp3` + matching `transcript.md`.

### 2.6 Build order
1. Stage 1 + speaker-map inversion/slug-resolution from `content/shibboleth.json` (no API keys).
2. Stage 2 single long-context pass → **validate beats on `105`, `102`, `106`** before proceeding.
3. Stage 3 script (structured tool-use, wiki grounding, persona prompt caching).
4. Stage 4 Edge TTS behind `TTSProvider`.
5. Stage 5 ffmpeg concat + `loudnorm`.

### 2.7 Highest risk
Stage 2's ability to separate in-game story from table talk. De-risk on 2–3 transcripts first; everything downstream is plumbing.

---

## Part 3 — As built

All five stages are implemented and validated end-to-end (transcript →
`episode.mp3` + `transcript.md`). See `README.md` for usage. The highest-risk
bet (§2.7) paid off: Stage 2 distillation cleanly separates story from table talk
— validated live on `105`/`102`/`106` and a 4-player main-campaign session.

| Stage | Module | Status & notes |
|---|---|---|
| 1 Ingest | `src/ingest/` | All 39 transcripts parse; speakers resolved from `shibboleth.json` (inverted, arc-scoped); wiki link-graph resolves 237/237 links. Sessions sort chronologically (fixed an unpadded-date lexical-sort bug). |
| 2 Distill | `src/distill/` | Long-context single pass, forced tool-use, disk-cached. Live-validated. |
| 3 Script | `src/script/` | Two hosts **Reed/Quill** (configurable), wiki-grounded, TTS-normalized; carries a **pronunciation lexicon** (`content/pronunciations.json` overrides the seed). |
| 4 TTS | `src/tts/` | `TTSProvider` seam with three backends: offline **mock**, free **Edge TTS** (`msedge-tts`), and **ElevenLabs** (default; `eleven_v3` with per-turn emotion → audio tags). Per-turn clips + manifest. Live-synthesized 159 Edge mp3 clips. |
| 5 Assemble | `src/assemble/` | ffmpeg concat + EBU R128 `loudnorm`; jittered inter-turn gaps (longer on speaker change); emits `episode.mp3` + `transcript.md`. |

**Deviations / additions beyond the original contracts:**
- Shared LLM client extracted to `src/llm/client.ts` (used by Distill + Script).
- `SessionDigest` gained `synopsis`; `Script` gained `hosts` + `pronunciations`.
- Every stage has a disk-cached `loadOrX` seam (`out/<id>.*`), keyed for re-use by
  the next stage; expensive Opus/TTS calls happen at most once per session.
- LLM/TTS backends sit behind interfaces so the **whole test suite runs offline**
  with no API key (116 tests).
- The ElevenLabs provider (originally deferred) is now implemented and the default.
- Deferred (as planned): arc-level episodes, map-reduce distillation, music/intro,
  chapter markers, and a web UI.
