import { describe, expect, test } from "bun:test";
import { hashString, seededGrime, grimeFor } from "./seed.ts";

describe("seeded imperfection (R-17)", () => {
  test("hashString is deterministic and varies with input", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  test("grime stays within bounds", () => {
    for (const seed of [0, 1, 123456, 0xffffffff, 987654321]) {
      const g = seededGrime(seed);
      expect(g.rotateDeg).toBeGreaterThanOrEqual(-2);
      expect(g.rotateDeg).toBeLessThanOrEqual(2);
      expect(g.ringX).toBeGreaterThanOrEqual(15);
      expect(g.ringX).toBeLessThanOrEqual(85);
      expect(g.ringScale).toBeGreaterThanOrEqual(0.8);
      expect(g.ringScale).toBeLessThanOrEqual(1.6);
    }
  });

  test("same content → identical grime (diff-stable export)", () => {
    expect(grimeFor("the bridge is out")).toEqual(grimeFor("the bridge is out"));
    expect(grimeFor("a")).not.toEqual(grimeFor("b"));
  });
});
