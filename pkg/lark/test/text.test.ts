import { describe, expect, test } from "bun:test";
import { normalizeTag, slugify, uniqueSlug } from "../src/lib/text";

describe("normalizeTag", () => {
  test("trims, collapses, lowercases", () => {
    expect(normalizeTag("  Calm  ")).toBe("calm");
    expect(normalizeTag("Boss   Fight")).toBe("boss fight");
    expect(normalizeTag("CALM")).toBe("calm");
  });
});

describe("slugify", () => {
  test("makes url-safe slugs", () => {
    expect(slugify("Final Fantasy VII")).toBe("final-fantasy-vii");
    expect(slugify("  The Legend of Zelda: BotW!  ")).toBe("the-legend-of-zelda-botw");
  });
  test("strips diacritics", () => {
    expect(slugify("Pokémon")).toBe("pokemon");
  });
});

describe("uniqueSlug", () => {
  test("returns base when free", () => {
    expect(uniqueSlug("zelda", () => false)).toBe("zelda");
  });
  test("appends -2 etc when taken", () => {
    const taken = new Set(["zelda", "zelda-2"]);
    expect(uniqueSlug("zelda", (s) => taken.has(s))).toBe("zelda-3");
  });
  test("falls back to untitled for empty base", () => {
    expect(uniqueSlug("", () => false)).toBe("untitled");
  });
});
