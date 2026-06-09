import { describe, expect, test } from "bun:test";
import { docToHash, hashToDoc, decodeDoc, isShareable } from "./shareLink.ts";

describe("share link", () => {
  test("round-trips a document through the URL hash", () => {
    const source = ":::statblock[Goblin]{level=\"Creature 1\"}\nA menace :action[2].\n:::";
    const hash = docToHash(source);
    expect(hash.startsWith("#doc=")).toBe(true);
    expect(hashToDoc(hash)).toBe(source);
  });

  test("hashToDoc rejects non-doc and garbage hashes", () => {
    expect(hashToDoc("#other=abc")).toBeNull();
    expect(hashToDoc("#doc=!!!notvalid!!!")).toBeNull();
    expect(decodeDoc("")).toBeNull();
  });

  test("isShareable flags oversized documents (R-20)", () => {
    expect(isShareable("small")).toBe(true);
    // High-entropy (poorly compressible) content via a deterministic LCG, so
    // the encoded form genuinely exceeds the hash ceiling.
    let h = 12345;
    let big = "";
    while (big.length < 60_000) {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      big += h.toString(36);
    }
    expect(isShareable(big)).toBe(false);
  });
});
