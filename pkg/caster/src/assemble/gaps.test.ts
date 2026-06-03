import { test, expect, describe } from "bun:test";
import { computeGaps, DEFAULT_GAP_OPTIONS } from "./gaps.ts";

const noJitter = () => 0.5; // (0.5*2-1) = 0 → no jitter, deterministic

describe("computeGaps", () => {
  test("shorter within a speaker run, longer on a speaker change", () => {
    const gaps = computeGaps(["A", "A", "B", "B"], DEFAULT_GAP_OPTIONS, noJitter);
    expect(gaps).toEqual([200, 400, 200]); // A→A, A→B, B→B
  });

  test("returns one gap fewer than the number of turns", () => {
    expect(computeGaps(["A", "B", "A"], DEFAULT_GAP_OPTIONS, noJitter)).toHaveLength(2);
    expect(computeGaps(["A"], DEFAULT_GAP_OPTIONS, noJitter)).toEqual([]);
  });

  test("jitter is quantized to the step", () => {
    // rng=1 → +jitterMs (100) on top of base; quantize 50 → multiples of 50.
    const gaps = computeGaps(["A", "A"], DEFAULT_GAP_OPTIONS, () => 1);
    expect(gaps[0]! % DEFAULT_GAP_OPTIONS.quantizeMs).toBe(0);
    expect(gaps[0]).toBe(300); // 200 + 100
  });

  test("clamps to [minMs, maxMs]", () => {
    const opts = { ...DEFAULT_GAP_OPTIONS, changeMs: 5000, jitterMs: 0, maxMs: 800 };
    expect(computeGaps(["A", "B"], opts, noJitter)).toEqual([800]);
  });
});
