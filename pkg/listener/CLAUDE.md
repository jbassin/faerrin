# CLAUDE.md — `listener`

Bun-workspace member that produces the campaign's raw session data: it turns **Craig** Discord
recordings into a per-session transcript (`script.json`) and a merged `audio.mp3`. `shared-content`
ingests the transcript; quartz serves the audio. This is the **upstream producer** for the whole
content pipeline.

## ⚠️ Deliberate Python exception to "Bun everywhere"

This package is **Python**, not Bun — on purpose. Transcription uses **whisperx (Whisper large-v3 +
PyTorch + faster-whisper)**, which has no credible TypeScript equivalent, and the decision is to keep
transcription **local** (offline, free, proven quality). Everything else in the monorepo stays Bun.

**Migration status (Phase 1 — vendor as-is, made portable):** the original `listener_wretch` project
was imported here verbatim under `python/`, with hardcoded host paths replaced by env-overridable,
location-derived defaults. The **target end-state is hybrid**: TS orchestration (watch, state, unzip,
audio-merge via ffmpeg, script assembly, publish) around a thin `python/transcribe.py` whisper CLI.
That's Phase 2 — not done yet. See `.claude/session-plan.md` at the repo root.

## System dependencies (host, not bun)

- **uv** (Python runner) — `python/` is a uv project (Python 3.11, see `python/.python-version`).
- **ffmpeg** — required by `pydub` for the audio merge.
- **~2.9GB whisper model** — downloaded on first run into `data/models/` (`Systran/faster-whisper-large-v3`).
- **Disk** — `data/saved/` grows ~400MB/session (~27GB across the existing 82 sessions).

## Run

```sh
bun run --filter listener process   # main pipeline: new Craig zips -> saved/{date}/{audio.mp3,script.json,...}
bun run --filter listener script    # regenerate script.json from existing per-user segment JSONs
bun run --filter listener clean      # state inspection
# or from this dir: cd python && uv run process.py
```

Bun does not auto-load `.env` for the Python subprocess; `consts.py` reads `os.environ` directly and
derives sensible defaults, so it runs with zero config. Override via real env vars (or your shell)
per `.env.example`.

## Layout

| Path | What |
|------|------|
| `python/process.py` | main pipeline (watch Craig zips → unzip → merge audio → transcribe → assemble script) |
| `python/script.py` | rebuild `script.json` from existing per-user segment JSONs |
| `python/models.py` | whisperx model loaders (cached once per process via `run_once`) |
| `python/sound_stack.py` | time-orders per-user segments into one transcript |
| `python/consts.py` | env-overridable config (paths derived from package location) + PLAYERS roster |
| `data/` (gitignored) | sessions (`saved/{date}/`), whisper model, `data.pkl` state — **never committed** |

## Gotchas

- **Never commit `data/` or `tmp/`** — 36GB of audio + model + state. The `.gitignore` guards this;
  keep it strict.
- **Roster duplication:** `consts.PLAYERS` mirrors `shared-content/scripts/lib/roster.ts` (`userToName`).
  Phase 2 collapses these to one SSOT — until then, keep them in sync.
- **Don't re-transcribe history.** Historical transcripts are already canonical in
  `shared-content/scripts/data`. Whisper output is non-deterministic across versions; this pipeline is
  for **new** sessions only.
- **Known regression (accepted):** output went lowercase/unpunctuated as of ~2026-6-1 (an upstream
  whisperx model/config change). Accepted for now; revisit post-migration.
- **State DB is near-disposable:** processed zips are deleted after processing, so `data.pkl` mostly
  guards against re-processing the current incoming batch.
