from typing import Any


class SoundStack:
    sounds: dict[str, list[list[dict[str, Any]]]]

    def __init__(self) -> None:
        self.sounds = {}

    def add(self, user: str, var: list[dict[str, Any]]):
        stack = self.sounds.get(user, [])
        stack.append(var)

        self.sounds[user] = stack

    def next(self) -> dict[str, Any] | None:
        lowest_username = ""
        lowest_idx = -1
        lowest_start = 9999999999

        for username in self.sounds.keys():
            for idx, val in enumerate(self.sounds[username]):
                if len(val) == 0:
                    continue

                start = val[0].get("start", 9999999999)
                if start < lowest_start:
                    lowest_username = username
                    lowest_idx = idx
                    lowest_start = start

        if lowest_username != "":
            stk = self.sounds[lowest_username][lowest_idx]
            res = stk.pop(0)
            self.sounds[lowest_username][lowest_idx] = stk

            res["user"] = lowest_username
            return res

        return None

    def drain(self) -> list[dict[str, Any]]:
        res = []
        while True:
            n = self.next()
            if n is None:
                break

            res.append(n)

        return res
