# caster

Turns Pathfinder 2e home-campaign **session transcripts** into a three-host,
podcast-style **audio recap** — a lively roundtable grounded against the
campaign's setting wiki.

```
content/transcripts/NNN.arc.DATE.txt ─┐
content/wiki/**/*.md ─────────────────┤
content/shibboleth.json ──────────────┘
        │
        ▼   five stages, each cached to disk in out/
[1 Ingest]  parse transcript + resolve speakers + build wiki link-graph
[2 Distill] transcript → ordered story beats (+stakes/details/mood) (Claude, Opus 4.8)
[3 Script]  beats → Reed/Quill/Charlotte roundtable           (Claude, wiki-grounded, inline v3 audio tags)
[4 TTS]     script → audio clips                              (ElevenLabs v3 Text-to-Dialogue · Edge free · mock offline)
[5 Assemble]clips → episode.mp3 + transcript.md              (ffmpeg: concat + loudnorm)
```

## Prerequisites

- [Bun](https://bun.com) (the project is Bun-first; no Node/npm needed).
- `ffmpeg` + `ffprobe` on `PATH` — required for **Stage 5 (assemble)** only.
- `ANTHROPIC_API_KEY` in `.env` — required for **Distill** and **Script** (Claude). Bun auto-loads `.env`.
- TTS providers (Stage 4): **ElevenLabs** is the default (`ELEVENLABS_API_KEY`, paid). On `eleven_v3` it uses the **Text-to-Dialogue** API — turns are chunked (≈2,000 chars/call) and synthesized as naturally-paced multi-speaker clips, with delivery driven by inline v3 audio tags in the script. **Edge** is free (`--provider=edge`, just network, per-turn, tags stripped); **mock** is offline silent audio (`--provider=mock`, used by the tests).

```bash
bun install
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env    # for distill + script
echo 'ELEVENLABS_API_KEY=...'       >> .env    # for the default TTS provider (or use --provider=edge)
```

## Content layout

| Path | What |
|---|---|
| `content/transcripts/NNN.arc-slug.YYYY-M-D.txt` | Machine transcripts, lines `NNNNNN\tSpeaker: text` |
| `content/wiki/**/*.md` | Obsidian-style setting wiki (`[[wikilinks]]`, frontmatter) |
| `content/shibboleth.json` | Speaker map: `arcTitle → { isMain, roles: player → [{name, desc}] }` |
| `content/pronunciations.json` | *(optional)* `[{ term, say }]` — overrides/extends the seed lexicon |

## Usage

```bash
bun run ingest [<id|arc>]            # inspect the corpus (no API key needed)

bun run distill <id|arc> [--force]                 # Stage 2 — needs ANTHROPIC_API_KEY
bun run script  <id|arc> [--force]                 # Stage 3 — needs key + a cached digest
bun run tts     <id|arc> [--provider=elevenlabs|edge|mock] [--force]  # Stage 4 — default elevenlabs
bun run assemble <id|arc>                          # Stage 5 — needs ffmpeg + manifest + script
```

`<id|arc>` matches a full session id (`000.through-a-song-darkly.2026-5-25`), an
id prefix, or an arc slug (which resolves to that arc's chronologically-first
session). Each stage **caches** its output and is skipped on re-run unless
`--force` (or, for assemble, it always re-renders). Stage 4 defaults to the
**ElevenLabs** provider (needs `ELEVENLABS_API_KEY`); pass `--provider=edge` for
free audio or `--provider=mock` for offline silent placeholders.

Example, end to end for one session:

```bash
bun run distill 000.through-a-song-darkly.2026-5-25
bun run script  000.through-a-song-darkly.2026-5-25
bun run tts     000.through-a-song-darkly.2026-5-25                  # ElevenLabs (or --provider=edge)
bun run assemble 000.through-a-song-darkly.2026-5-25
# → out/000.through-a-song-darkly.2026-5-25.episode.mp3  (+ .transcript.md)
```

## Artifacts (`out/`, gitignored)

| File | Stage |
|---|---|
| `<id>.digest.json` | 2 — story beats |
| `<id>.script.json` | 3 — three-host roundtable dialogue with inline v3 audio tags |
| `<id>/NNN.{wav,mp3}` | 4 — audio clips (dialogue chunks on v3, else per-turn) |
| `<id>.audio.json` | 4 — clip manifest (mode, paths, speakers, durations) |
| `<id>.episode.mp3`, `<id>.transcript.md` | 5 — the finished episode |

## Project structure

```
src/
  types.ts            shared types (Session, SessionDigest, Script, AudioManifest, …)
  llm/client.ts       shared Anthropic client seam (forced tool-use, prompt caching)
  ingest/             Stage 1 — transcripts, speaker resolution, wiki graph
  distill/            Stage 2 — transcript → beats
  script/             Stage 3 — beats → dialogue (hosts, grounding, lexicon)
  tts/                Stage 4 — TTSProvider (elevenlabs v3 dialogue + edge + mock), chunking, audio tags
  assemble/           Stage 5 — gaps, concat list, transcript, ffmpeg
  cli.ts              the `ingest|distill|script|tts|assemble` commands
```

The LLM and TTS backends sit behind small interfaces (`LlmClient`, `TTSProvider`)
so they're mocked in tests — the suite runs fully offline with no API key.

## Development

```bash
bun test            # full suite (offline)
bun run typecheck   # tsc --noEmit (strict)
```

See [`docs/discovery-and-definition.md`](docs/discovery-and-definition.md) for the
design rationale (Double Diamond Discover/Define) and the as-built status.
