import { describe, expect, test } from "bun:test";
import { runPool } from "../src/lib/pool";

describe("runPool (B24)", () => {
  test("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("never exceeds the concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    await runPool([...Array(10).keys()], 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  test("an empty list is a no-op", async () => {
    let called = 0;
    await runPool([], 4, async () => {
      called++;
    });
    expect(called).toBe(0);
  });
});
