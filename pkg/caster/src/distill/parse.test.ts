import { test, expect, describe } from "bun:test";
import { DigestParseError, parseDigest } from "./parse.ts";

const validRaw = {
  synopsis: "The crew explores the slipped observatory.",
  beats: [
    { order: 2, summary: "They disarm a trap.", characters: ["Foral"], locations: ["Observatory"], wikiRefs: ["Sedecium"] },
    { order: 1, summary: "They enter the observatory.", characters: ["Foral", "Ozzie"], locations: ["Observatory"], wikiRefs: [] },
  ],
  discarded: ["you're laggy", "have you read Noah's book"],
};

describe("parseDigest", () => {
  test("parses a valid digest and attaches sessionId", () => {
    const d = parseDigest("105.x", validRaw);
    expect(d.sessionId).toBe("105.x");
    expect(d.synopsis).toContain("observatory");
    expect(d.discarded).toHaveLength(2);
  });

  test("sorts beats by model order then renumbers to contiguous 1-based", () => {
    const d = parseDigest("105.x", validRaw);
    expect(d.beats.map((b) => b.order)).toEqual([1, 2]);
    expect(d.beats[0]?.summary).toBe("They enter the observatory.");
    expect(d.beats[1]?.summary).toBe("They disarm a trap.");
  });

  test("carries enrichment fields (significance/details/tone/tableAngle) when present", () => {
    const d = parseDigest("x", {
      synopsis: "s",
      beats: [
        {
          order: 1,
          summary: "They spring the ambush.",
          significance: "First real test of the new alliance.",
          details: ["nat 20 on the opening shot", "  ", "Foral hesitates"],
          tone: "tense",
          tableAngle: "Was springing it early reckless or the only real play?",
        },
      ],
    });
    expect(d.beats[0]?.significance).toBe("First real test of the new alliance.");
    expect(d.beats[0]?.details).toEqual(["nat 20 on the opening shot", "Foral hesitates"]);
    expect(d.beats[0]?.tone).toBe("tense");
    expect(d.beats[0]?.tableAngle).toBe("Was springing it early reckless or the only real play?");
  });

  test("omits enrichment fields on older digests that lack them", () => {
    const d = parseDigest("x", { synopsis: "s", beats: [{ order: 1, summary: "a beat" }] });
    expect(d.beats[0]?.significance).toBeUndefined();
    expect(d.beats[0]?.details).toBeUndefined();
    expect(d.beats[0]?.tone).toBeUndefined();
    expect(d.beats[0]?.tableAngle).toBeUndefined();
  });

  test("defaults missing optional arrays to empty", () => {
    const d = parseDigest("x", {
      synopsis: "s",
      beats: [{ order: 1, summary: "a beat" }],
      // discarded omitted
    });
    expect(d.beats[0]?.characters).toEqual([]);
    expect(d.beats[0]?.wikiRefs).toEqual([]);
    expect(d.discarded).toEqual([]);
  });

  test.each([
    ["non-object", 42],
    ["missing synopsis", { beats: [{ order: 1, summary: "x" }] }],
    ["empty beats", { synopsis: "s", beats: [] }],
    ["beat missing summary", { synopsis: "s", beats: [{ order: 1 }] }],
    ["beat with empty summary", { synopsis: "s", beats: [{ order: 1, summary: "  " }] }],
    ["non-string in characters", { synopsis: "s", beats: [{ order: 1, summary: "x", characters: [5] }] }],
  ])("throws DigestParseError on %s", (_label, raw) => {
    expect(() => parseDigest("x", raw)).toThrow(DigestParseError);
  });
});
