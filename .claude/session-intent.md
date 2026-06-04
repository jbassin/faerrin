# Session Intent Contract

**Created:** 2026-06-04
**Plan:** See .claude/session-plan.md

## Job Statement

Import the `listener_wretch` project (currently at `/ruby/data/experiments/listener_wretch`,
external to the repo) into the Faerrin monorepo. It is the upstream producer of the data the
monorepo consumes: it turns Craig Discord recordings into per-session `script.json` transcripts
(pulled by `shared-content`'s ingest) and `audio.mp3` files (served to `quartz` listeners).

The challenge: it is **Python built on whisperx (Whisper large-v3 + PyTorch + ffmpeg)**, against a
repo whose convention is "Bun everywhere." It also has host coupling (hardcoded `/emerald` paths,
a Craig sync folder, a `shelve` state DB, a cron job) and is decoupled from the monorepo only over
HTTP (`static-audio.iridi.cc`).

## Decisions Captured (from intent questions)

- **Language:** Recommend in plan — **vendor Python as-is** and **hybrid (TS orchestration + Python
  whisper core)** are both live options; full TS rewrite is OFF the table.
- **Transcription:** **Keep local whisperx.** Offline, free, proven quality. The whisper step stays
  Python no matter what.
- **Integration seam:** **Re-wire into the build** — move away from the HTTP fetch toward the
  in-repo pipeline reading listener output directly (staged, behind a parity gate).
- **Optimize for (priorities):**
  1. Kill host coupling (remove `/emerald` hardcoding; env-configurable, portable).
  2. Language uniformity (reduce Python surface; honor "Bun everywhere" where feasible).
  3. Minimal risk to live sites (quartz + shared-content keep working; transcripts/audio uninterrupted).
  - NOT chosen: "low effort / just land it" — willing to invest for portability + uniformity.

## Success Criteria

- `listener_wretch` lives in-repo as a workspace package, runnable from the monorepo.
- No hardcoded host paths; everything via env/derived paths (matches `lib/paths.ts` pattern).
- The whisper transcription core remains local whisperx with unchanged output quality.
- The ingest seam is re-wired to read listener output directly, with **byte-identical**
  `shared-content/scripts/data/{date}.json` output proven on a sample session (live-site safety).
- The roster (Discord-ID → name) is unified to one SSOT instead of duplicated across languages.
- Whole workspace stays green (typecheck + tests); quartz build stays byte-identical (763 files).

## Boundaries / Non-Goals

- Do **not** re-transcribe historical sessions — those transcripts are already committed in
  `shared-content/scripts/data`. Whisper is non-deterministic across versions; re-running would
  churn committed data. Migration handles **new sessions going forward**.
- Do **not** commit audio/zip/model artifacts to git (hundreds of MB–GB). They stay gitignored and
  served as static files.
- Do **not** replace whisperx with an API or whisper.cpp (transcription stays local whisperx).
- `listener_wretch` has **no git history** (no `.jj`/`.git`) — nothing to preserve; clean import.

## Tension to Resolve

"Re-wire into the build" vs. "minimal risk to live sites" — the re-wire touches the live ingest
path. Resolved by **staging**: keep producing identical outputs, validate parity, then cut the
ingest source over from HTTP to local in a separate, reversible step.
