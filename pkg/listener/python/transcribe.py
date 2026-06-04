"""Thin whisper transcription CLI — the one irreducible Python step of the
hybrid pipeline. The TS orchestrator (src/process.ts) owns everything else.

Usage:
    uv run transcribe.py <out_dir> <audio.aac> [<audio.aac> ...]

For each input track it writes `<out_dir>/<stem>.json` containing the whisperx
segment array (start/end/text/words). The model loads once (models.run_once)
and is reused across every track in the batch — so the orchestrator must pass a
whole session's tracks in a single invocation, never one file per process.
"""

import json
import sys
from pathlib import Path

from loguru import logger as log
import whisperx

from consts import DEVICE
from models import get_alignment_model, get_transcription_model


def transcribe_file(aac_path: str, out_dir: str) -> str:
    stem = Path(aac_path).stem
    out_path = str(Path(out_dir) / f"{stem}.json")

    log.info("loading audio {}", stem)
    audio = whisperx.load_audio(aac_path)

    log.info("transcribing {}", stem)
    result = get_transcription_model().transcribe(audio, batch_size=16)

    log.info("aligning {}", stem)
    alignment_model, alignment_metadata = get_alignment_model()
    result = whisperx.align(
        result["segments"],
        alignment_model,
        alignment_metadata,
        audio,
        DEVICE,
        return_char_alignments=False,
    )

    with open(out_path, "w") as f:
        json.dump(result["segments"], f)

    log.info("wrote {}", out_path)
    return out_path


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        log.error("usage: transcribe.py <out_dir> <audio.aac> [<audio.aac> ...]")
        return 2

    out_dir = argv[0]
    Path(out_dir).mkdir(parents=True, exist_ok=True)

    for aac in argv[1:]:
        transcribe_file(aac, out_dir)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
