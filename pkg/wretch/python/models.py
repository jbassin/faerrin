from loguru import logger as log
import whisperx

from consts import (
    COMPUTE_TYPE,
    DATA_PATH,
    DEVICE,
    MODEL,
)


def run_once(f):
    has_run = False
    res = None

    def wrapper(*args, **kwargs):
        nonlocal has_run
        nonlocal res

        if not has_run:
            res = f(*args, **kwargs)
            has_run = True

        return res

    return wrapper


@run_once
def get_transcription_model():
    log.info("loading transcription model {}", MODEL)

    return whisperx.load_model(
        MODEL,
        DEVICE,
        compute_type=COMPUTE_TYPE,
        download_root=f"{DATA_PATH}/models",
        language="en",
    )


@run_once
def get_alignment_model():
    log.info("loading alignment model")
    return whisperx.load_align_model(
        language_code="en",
        device=DEVICE,
    )
