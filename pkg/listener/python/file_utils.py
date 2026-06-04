import os
import shutil
import tempfile

from consts import TMP_PATH
from loguru import logger as log

from file_data import FileData


class TempDir:
    __prefix: str | None = None
    __suffix: str | None = None
    __dir: str | None = None

    def __init__(
        self,
        prefix: str | None = None,
        suffix: str | None = None,
    ) -> None:
        self.__prefix = prefix
        self.__suffix = suffix

    def __enter__(self) -> str:
        self.__dir = tempfile.mkdtemp(
            dir=TMP_PATH, prefix=self.__prefix, suffix=self.__suffix
        )
        log.debug("creating temp directory {}", self.__dir)

        return self.__dir

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.__dir is not None:
            log.debug("removing temp directory {}", self.__dir)
            shutil.rmtree(self.__dir, ignore_errors=True)


def create_data_folder(data_path: str, remove_old=False):
    if remove_old:
        shutil.rmtree(data_path, ignore_errors=True)

    try:
        os.mkdir(data_path)
    except:
        pass


def delete_file(file: str):
    try:
        os.remove(file)
    except:
        pass

def move_file(from_: str, to_: str):
    try:
        delete_file(to_)
    except:
        pass

    shutil.move(from_, to_)

def get_files(path: str, ext: str | None = None) -> set[FileData]:
    res = []
    for file_name in os.listdir(path):
        if os.path.isfile(f"{path}/{file_name}") and (
            ext is None or f".{ext}" in file_name
        ):
            res.append(
                FileData(
                    path,
                    f"{path}/{file_name}",
                    file_name,
                    file_name.split(".")[0],
                )
            )

    return set(res)
