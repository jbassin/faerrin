import { expect, test } from "bun:test";
import { parseRollEvent } from "../src/schema";

test("parses the v0 (legacy) payload, deriving total from value", () => {
  const e = parseRollEvent({ user: "Faerrin", value: 12, is_crit: false, is_fumble: false });
  expect(e).not.toBeNull();
  expect(e).toMatchObject({
    user: "Faerrin",
    total: 12,
    isCrit: false,
    isFumble: false,
    expression: null,
    dice: null,
    modifier: null,
    v: 0,
  });
});

test("parses the v1 (rich) payload in full", () => {
  const e = parseRollEvent({
    v: 1,
    user: "Kethra",
    expression: "1d20+7",
    total: 27,
    dice: [20],
    modifier: 7,
    is_crit: true,
    is_fumble: false,
    ts: "2026-06-09T21:48:01Z",
  });
  expect(e).toMatchObject({
    v: 1,
    user: "Kethra",
    expression: "1d20+7",
    total: 27,
    dice: [20],
    modifier: 7,
    isCrit: true,
    isFumble: false,
    ts: "2026-06-09T21:48:01Z",
  });
});

test("stamps a timestamp when mouth omits one", () => {
  const e = parseRollEvent({ user: "Morrow", value: 1, is_crit: false, is_fumble: true });
  expect(typeof e?.ts).toBe("string");
  expect(Number.isNaN(Date.parse(e!.ts))).toBe(false);
  expect(e?.isFumble).toBe(true);
});

test("infers v=1 when an expression is present but v is missing", () => {
  const e = parseRollEvent({ user: "A", expression: "3d8", total: 14 });
  expect(e?.v).toBe(1);
});

test("rejects unusable bodies", () => {
  expect(parseRollEvent(null)).toBeNull();
  expect(parseRollEvent(42)).toBeNull();
  expect(parseRollEvent({})).toBeNull();
  expect(parseRollEvent({ user: "", value: 1 })).toBeNull(); // blank user
  expect(parseRollEvent({ user: "A" })).toBeNull(); // no total/value
  expect(parseRollEvent({ user: "A", value: "NaN" })).toBeNull(); // non-numeric
  expect(parseRollEvent({ user: "A", total: Infinity })).toBeNull(); // non-finite
});
