import { describe, expect, test } from "bun:test";
import { isAllowed, optionalEnv, parseAllowlist, requireEnv } from "../src/lib/config";

describe("requireEnv", () => {
  test("returns a trimmed present value", () => {
    expect(requireEnv("X", { X: "  hi  " })).toBe("hi");
  });
  test("throws on missing or blank", () => {
    expect(() => requireEnv("X", {})).toThrow(/Missing required env var X/);
    expect(() => requireEnv("X", { X: "   " })).toThrow(/Missing required env var X/);
  });
});

describe("optionalEnv", () => {
  test("uses the value when present, fallback otherwise", () => {
    expect(optionalEnv("X", "def", { X: "set" })).toBe("set");
    expect(optionalEnv("X", "def", {})).toBe("def");
    expect(optionalEnv("X", "def", { X: "  " })).toBe("def");
  });
});

describe("parseAllowlist", () => {
  test("splits on commas and whitespace, dropping blanks", () => {
    const set = parseAllowlist("111, 222\n333  444,");
    expect([...set].sort()).toEqual(["111", "222", "333", "444"]);
  });
  test("empty/undefined yields an empty set", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("   ").size).toBe(0);
  });
  test("membership", () => {
    const set = parseAllowlist("111,222");
    expect(isAllowed("111", set)).toBe(true);
    expect(isAllowed("999", set)).toBe(false);
  });
});
