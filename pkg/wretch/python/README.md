# wretch/python

The Python layer of [`wretch`](../) — a [uv](https://docs.astral.sh/uv/) project (Python 3.11). The
monorepo is otherwise Bun; this is the deliberate exception, because transcription uses
**whisperx** (Whisper large-v3 + PyTorch + faster-whisper), which has no credible TypeScript
equivalent and is kept local on purpose.

## The one active step: `transcribe.py`

In the target hybrid architecture, the TS orchestrator (`../src/process.ts`) owns everything —
watch, unzip, ffmpeg audio-merge, script assembly, publish — and shells out to a single thin Python
CLI for transcription only:

```bash
uv run transcribe.py <out_dir> <audio.aac> [<audio.aac> ...]
```

For each input track it writes `<out_dir>/<stem>.json` (the whisperx segment array:
start/end/text/words). The model loads **once per invocation** and is reused across every track in the
batch — so the orchestrator passes a whole session's tracks in one call, never one process per file.
Already-finished tracks are skipped, so a crash resumes per track.

## Legacy all-Python pipeline (fallback)

`process.py` / `script.py` / `clean.py` (plus helpers `consts.py`, `db.py`, `file_data.py`,
`file_utils.py`, `models.py`, `sound_stack.py`) are the original end-to-end Python pipeline, retained
as a fallback during the migration (`bun run --filter wretch process:py`). It keeps its own
`data/data.pkl` shelve state and uses `consts.py PLAYERS` for track filtering — whereas the TS path
uses the shared roster SSOT. Pick one path per host.

See the package [`CLAUDE.md`](../CLAUDE.md) for the hybrid architecture, system dependencies, and the
reconciler model.
