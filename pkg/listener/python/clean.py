import json
import os
from loguru import logger as log

from consts import DATA_PATH
from db import DB
from file_utils import get_files
from sound_stack import SoundStack


@log.catch
def main():
    log.info("running cleaner")

    with DB() as db:
        log.info("cleaning {} files", len(db.processed))

if __name__ == "__main__":
    main()
