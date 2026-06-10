import { expect, test } from "bun:test";
import { pushRoll, type TickerRoll } from "../src/ticker";

function row(id: string, total: number): TickerRoll {
  return {
    id,
    v: 1,
    user: "X",
    expression: null,
    total,
    dice: null,
    modifier: null,
    isCrit: false,
    isFumble: false,
    ts: "t",
  };
}

test("prepends newest and caps at max, dropping the oldest", () => {
  let list: TickerRoll[] = [];
  for (const id of ["a", "b", "c", "d"]) {
    list = pushRoll(list, row(id, 0), 3);
  }
  expect(list.map((r) => r.id)).toEqual(["d", "c", "b"]);
  expect(list).toHaveLength(3);
});

test("does not mutate the input list", () => {
  const orig = [row("a", 1)];
  const next = pushRoll(orig, row("b", 2), 5);
  expect(orig).toHaveLength(1);
  expect(next.map((r) => r.id)).toEqual(["b", "a"]);
});
