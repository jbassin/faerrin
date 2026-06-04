import shelve
from typing import Any

from consts import STATE_FILE
from file_data import FileData


class DB:
    db: shelve.Shelf[Any]

    __proceessed = "processed"

    def __init__(self, path: str = STATE_FILE) -> None:
        self.db = shelve.open(path)

    def __enter__(self) -> "DB":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.db.close()

    @property
    def processed(self) -> set[FileData]:
        return set(self.db.get(self.__proceessed, []))

    @processed.setter
    def processed(self, val: set[FileData]):
        self.db[self.__proceessed] = list(val)

    def add_processed(self, fd: FileData):
        processed = self.processed
        processed.add(fd)
        self.processed = processed
