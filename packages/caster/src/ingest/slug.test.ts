import { test, expect, describe } from "bun:test";
import { slugify } from "./slug.ts";

describe("slugify", () => {
  test.each([
    ["Through a Song, Darkly", "through-a-song-darkly"],
    ["Interred in Iomenei", "interred-in-iomenei"],
    ["Fae and Forest", "fae-and-forest"],
    ["A Hunt of Metal and Vine", "a-hunt-of-metal-and-vine"],
    ["The First Spark", "the-first-spark"],
    ["Observatory, Slipped", "observatory-slipped"],
    ["Fey in the Mists", "fey-in-the-mists"],
  ])("maps %p -> %p", (title, expected) => {
    expect(slugify(title)).toBe(expected);
  });

  test("drops apostrophes without inserting a separator", () => {
    expect(slugify("Hallia's Masque")).toBe("hallias-masque");
  });

  test("trims and collapses punctuation runs", () => {
    expect(slugify("  Foo --- Bar!!  ")).toBe("foo-bar");
  });
});
