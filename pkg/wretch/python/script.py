import json
import os
from loguru import logger as log

from consts import DATA_PATH
from file_utils import get_files
from sound_stack import SoundStack


@log.catch
def main():
    log.info("running script generation")

    dirs = [f"{DATA_PATH}/saved/{d}" for d in os.listdir(f"{DATA_PATH}/saved")]
    log.info("found {} dirs for processing", len(dirs))

    for d in dirs:
        process_dir(d)


def process_dir(d: str):
    stack = SoundStack()

    files = [f for f in get_files(d, "json") if f != "script.json"]
    for file in files:
        username = file.file_stem.split("~")[0]
        segments = []

        with open(file.file_path, "r") as t:
            segments = json.load(t)

        stack.add(username, segments)

    script = stack.drain()
    with open(f"{d}/script.json", "w") as t:
        json.dump(script, t)


if __name__ == "__main__":
    main()
