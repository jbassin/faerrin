import { test, expect, describe } from "bun:test";
import { renderDelivery, stripAudioTags } from "./tags.ts";

describe("stripAudioTags", () => {
  test("removes inline tags and tidies whitespace", () => {
    expect(stripAudioTags("[warm] Hey everyone. [laughs] Big week.")).toBe(
      "Hey everyone. Big week.",
    );
  });

  test("doesn't strand punctuation left by a removed tag", () => {
    expect(stripAudioTags("Well [pause], maybe.")).toBe("Well, maybe.");
  });

  test("leaves tag-free text untouched", () => {
    expect(stripAudioTags("hello")).toBe("hello");
  });

  test("handles multi-word and back-to-back tags", () => {
    expect(stripAudioTags("[French accent][whispers] Bonjour.")).toBe("Bonjour.");
  });
});

describe("renderDelivery", () => {
  test("v3 keeps inline tags and promotes a legacy emotion to a leading tag", () => {
    expect(renderDelivery("[laughs] Sure.", "warm", true)).toBe("[warm] [laughs] Sure.");
    expect(renderDelivery("Plain line.", undefined, true)).toBe("Plain line.");
  });

  test("non-v3 strips tags and ignores emotion", () => {
    expect(renderDelivery("[warm] Hey. [laughs]", "excited", false)).toBe("Hey.");
  });
});
