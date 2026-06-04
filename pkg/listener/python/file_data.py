from dataclasses import dataclass


@dataclass(eq=True, frozen=True)
class FileData:
    dir_path: str
    file_path: str
    file_name: str
    file_stem: str

    def username(self):
        split = self.file_stem.split("-")
        if len(split) != 2:
            return ""

        split = split[1].split("_")
        if len(split) == 1:
            return split[0]

        return "_".join(split[: len(split) - 1])

    def index(self):
        split = self.file_stem.split("-")
        if len(split) != 2:
            return ""

        split = split[1].split("_")
        if len(split) == 1:
            return "0"

        return split[len(split) - 1]

    def date(self) -> str:
        split = self.file_stem.split("_")
        if len(split) != 4:
            return ""

        return split[2]
