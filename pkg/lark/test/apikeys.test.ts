import { describe, expect, test } from "bun:test";
import { extractApiKey, generateKey, hashKey, verifyKey } from "../src/server/apikeys";

describe("api keys", () => {
  test("generates raw + matching hash + prefix", () => {
    const k = generateKey();
    expect(k.raw.startsWith("lark_")).toBe(true);
    expect(k.hash).toBe(hashKey(k.raw));
    expect(k.raw.startsWith(k.prefix)).toBe(true);
    expect(k.prefix.length).toBe(12);
  });

  test("verifyKey accepts the right key, rejects others", () => {
    const k = generateKey();
    expect(verifyKey(k.raw, k.hash)).toBe(true);
    expect(verifyKey("lark_wrong", k.hash)).toBe(false);
  });

  test("two generated keys are distinct", () => {
    expect(generateKey().raw).not.toBe(generateKey().raw);
  });

  test("extractApiKey reads Bearer and X-Lark-Key", () => {
    expect(extractApiKey(new Headers({ authorization: "Bearer abc" }))).toBe("abc");
    expect(extractApiKey(new Headers({ "x-lark-key": "xyz" }))).toBe("xyz");
    expect(extractApiKey(new Headers())).toBeNull();
  });
});
