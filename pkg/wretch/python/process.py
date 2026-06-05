import json
from zipfile import ZipFile
from loguru import logger as log
from pydub import AudioSegment
import whisperx

from consts import DATA_PATH, DEVICE, INCOMING_PATH, PLAYERS
from db import DB
from file_data import FileData
from file_utils import TempDir, create_data_folder, get_files, move_file, delete_file
from models import get_alignment_model, get_transcription_model
from sound_stack import SoundStack


@log.catch
def main():
    log.info("running craig output processing")

    all_files = get_files(INCOMING_PATH, "zip")
    log.info("found {} files", len(all_files))

    with DB() as db:
        to_process = all_files.difference(db.processed)
        log.info("processing {} files", len(to_process))

        for fd in to_process:
            process_zip(db, fd)


def process_zip(db: DB, fd: FileData):
    log.info("processing zip file {}", fd.file_stem)

    with TempDir() as temp_path:
        log.info("unzipping into {}", temp_path)
        with ZipFile(fd.file_path, "r") as zip_ref:
            zip_ref.extractall(temp_path)
            log.info("complete unzipping file {}", fd.file_stem)

        data_path = f"{DATA_PATH}/saved/{fd.date()}"
        log.info(f"creating path: {data_path}")
        create_data_folder(data_path)

        merge_sound_files(temp_path, data_path)

        log.info("transcribing audio")
        stack = SoundStack()
        for file in get_files(temp_path, "aac"):
            res = transcribe(data_path, file)
            if res is not None:
                username, segments = res
                stack.add(username, segments)

        script = stack.drain()
        with open(f"{data_path}/script.json", "w") as t:
            json.dump(script, t)

        db.add_processed(fd)
        delete_file(fd.file_path)


def merge_sound_files(temp_path: str, data_path: str):
    log.info("merging sound files")

    sounds = []
    longest_ms: int = 0
    for file in get_files(temp_path, "aac"):
        if not any([username in file.file_stem for username in PLAYERS.values()]):
            log.info(f"skipping {file.file_stem}")
            continue

        s: AudioSegment = AudioSegment.from_file(file.file_path)
        longest_ms = max(longest_ms, int(s.duration_seconds) * 1000)
        sounds.append(s)

    log.info("generating audio file ({})", longest_ms / 1000.0)
    audio_file = AudioSegment.silent(duration=longest_ms)
    for sound in sounds:
        audio_file = audio_file.overlay(sound)

    audio_file.export(f"{data_path}/audio.mp3", format="mp3")
    log.info("completed audio file merging")


def transcribe(data_path: str, file: FileData):
    if not any([username in file.file_stem for username in PLAYERS.values()]):
        log.info("skipping {}", file.file_stem)
        return None

    log.info("loading audio file {} ({})", file.file_stem, file.username())
    audio = whisperx.load_audio(file.file_path)

    log.info("transcribing {}", file.file_stem)
    result = get_transcription_model().transcribe(
        audio,
        batch_size=16,
    )

    log.info("aligning {}", file.file_stem)
    alignment_model, alignment_metadata = get_alignment_model()

    result = whisperx.align(
        result["segments"],
        alignment_model,
        alignment_metadata,
        audio,
        DEVICE,
        return_char_alignments=False,
    )

    with open(f"{data_path}/{file.username()}~{file.index()}.json", "w") as t:
        json.dump(result["segments"], t)
    
    move_file(file.file_path, f"{data_path}/{file.file_name}")

    log.info("completed transcribing {}", file.username())
    return (file.username(), result["segments"])


if __name__ == "__main__":
    main()
