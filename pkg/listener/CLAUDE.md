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

## Architecture (hybrid)

TS orchestration (`src/`) around a thin Python whisper CLI (`python/transcribe.py`). The TS side owns
watch / state / unzip / audio-merge (ffmpeg) / script assembly / publish; **only transcription is
Python** (whisperx — no credible TS equivalent, kept local on purpose).

```
Craig .zip ─▶ src/process.ts ─┬─ unzip ─┬─ ffmpeg amix ─▶ saved/{date}/audio.mp3
                              │         └─ python/transcribe.py (whisperx) ─▶ per-track segments
                              └─ SoundStack merge ─▶ saved/{date}/script.json
```

## System dependencies (host, not bun)

- **uv** (Python runner) — `python/` is a uv project (Python 3.11, see `python/.python-version`).
- **ffmpeg** — audio merge (`src/audio.ts`, replacing pydub).
- **unzip** — zip extraction (`src/process.ts`).
- **~2.9GB whisper model** — downloaded on first run into `data/models/` (`Systran/faster-whisper-large-v3`).
- **Disk** — `data/saved/` grows ~400MB/session (~27GB across the existing 82 sessions).

## Run

```sh
bun run --filter listener process   # reconcile(): transcribe any landed-but-unprocessed Craig zips
bun run --filter listener process:py  # legacy all-Python pipeline (fallback during migration)
bun run --filter listener typecheck
bun run --filter listener test
```

Paths derive from the package location and are overridable via `LISTENER_*` env vars (see
`.env.example`). `LISTENER_KEEP_ZIP=1` preserves source zips (useful when validating against real
recordings). The Python `consts.py` reads `os.environ` directly (Bun doesn't auto-load `.env` for the
subprocess), so set real env vars when overriding.

## The reconciler model

`src/process.ts` is **level-triggered**, not event-driven: each `reconcile()` run observes desired
state (zips in `incoming`) vs actual state (`saved/{date}/script.json` present) and materializes the
gap. There is **no persisted job state** — the filesystem is the ledger — so any trigger (cron, a
systemd `.path` unit, a manual run) can call it at any time, idempotently. A single-flight lock
(`data/.reconcile.lock`) prevents overlapping runs. Readiness is gated by `unzip -t` (robust on
synced/FUSE drives where inotify/lsof lie). Outputs use **atomic appearance** (write `.tmp` → rename),
and `transcribe.py` skips already-finished tracks — so a crash mid-session resumes per track (~30min)
instead of redoing hours. Only the expensive transcription node carries this discipline; the cheap
downstream rebuild (ingest → caster → quartz) is wired at the Phase 4 cutover.

## Layout

| Path | What |
|------|------|
| `src/process.ts` | **reconcile()** — level-triggered: pending sessions → materialize → (downstream rebuild) |
| `src/soundStack.ts` | time-orders per-user segments into one transcript (port of sound_stack.py) |
| `src/fileData.ts` | Craig filename parsing (port of file_data.py) |
| `src/roster.ts` | re-exports `isPlayer` from shared-content's roster (the SSOT) |
| `src/{audio,transcribe,exec,fsx,paths}.ts` | ffmpeg merge · python CLI call · subprocess helpers · atomic write · config |
| `python/transcribe.py` | **the one Python step**: whisperx, per-track resume, model loaded once per batch |
| `python/{process,script,clean}.py` | legacy all-Python pipeline (fallback) + helpers it imports |
| `data/` (gitignored) | sessions (`saved/{date}/`), whisper model, lock — **never committed** |

## Gotchas

- **Never commit `data/` or `tmp/`** — 36GB of audio + model + state. The `.gitignore` guards this;
  keep it strict.
- **Roster SSOT:** track-filtering uses `isPlayer` from `shared-content/scripts/lib/roster.ts` (the
  same map ingest uses). The legacy `python/consts.py PLAYERS` is only used by the `process:py`
  fallback — prefer the roster.
- **Disk is the ledger (TS path):** the reconciler dedups on `saved/{date}/script.json` existence —
  no `state.json`. Deleting the source zip is hygiene, not correctness (a kept zip is simply skipped).
  The legacy `process:py` path still uses its own `data/data.pkl` shelve state — pick one per host.
- **Don't re-transcribe history.** Historical transcripts are already canonical in
  `shared-content/scripts/data`. Whisper output is non-deterministic across versions; this pipeline is
  for **new** sessions only.
- **Known regression (accepted):** output went lowercase/unpunctuated as of ~2026-6-1 (an upstream
  whisperx model/config change). Accepted for now; revisit post-migration.
