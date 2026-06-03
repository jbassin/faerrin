import { test, expect, describe } from "bun:test";
import { ScriptParseError, parseScript } from "./parse.ts";

const valid = {
  title: "The Slipped Observatory",
  turns: [
    { speaker: "A", text: "Welcome back to the show!", emotion: "excited" },
    { speaker: "B", text: "Today we're aboard a sunken station." },
  ],
};

describe("parseScript", () => {
  test("parses a valid script and attaches sessionId", () => {
    const s = parseScript("105.x", valid);
    expect(s.sessionId).toBe("105.x");
    expect(s.title).toBe("The Slipped Observatory");
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0]?.emotion).toBe("excited");
  });

  test("accepts the third host (speaker C)", () => {
    const s = parseScript("x", { title: "t", turns: [{ speaker: "C", text: "My turn." }] });
    expect(s.turns[0]?.speaker).toBe("C");
  });

  test("drops blank/absent emotion", () => {
    const s = parseScript("x", { title: "t", turns: [{ speaker: "A", text: "hi", emotion: "  " }] });
    expect(s.turns[0]?.emotion).toBeUndefined();
  });

  test.each([
    ["non-object", 1],
    ["missing title", { turns: [{ speaker: "A", text: "x" }] }],
    ["empty title", { title: " ", turns: [{ speaker: "A", text: "x" }] }],
    ["empty turns", { title: "t", turns: [] }],
    ["bad speaker", { title: "t", turns: [{ speaker: "D", text: "x" }] }],
    ["empty text", { title: "t", turns: [{ speaker: "A", text: "" }] }],
  ])("throws ScriptParseError on %s", (_label, raw) => {
    expect(() => parseScript("x", raw)).toThrow(ScriptParseError);
  });
});
