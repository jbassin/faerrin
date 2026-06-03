import { test, expect, describe } from "bun:test";
import type { ResolvedSpeaker } from "../types.ts";
import { dateSortKey, parseFilename, parseTranscript, type ArcSpeakers } from "./transcript.ts";

describe("parseFilename", () => {
  test("splits arc number, slug, and date", () => {
    expect(parseFilename("content/transcripts/105.observatory-slipped.2026-4-27.txt")).toEqual({
      arcNumber: "105",
      arc: "observatory-slipped",
      date: "2026-4-27",
      id: "105.observatory-slipped.2026-4-27",
    });
  });

  test("keeps hyphenated slugs intact", () => {
    expect(parseFilename("000.through-a-song-darkly.2025-10-20.txt")?.arc).toBe(
      "through-a-song-darkly",
    );
  });

  test("returns null for non-matching names", () => {
    expect(parseFilename("notes.md")).toBeNull();
  });
});

describe("dateSortKey", () => {
  test("orders unpadded dates chronologically, not lexically", () => {
    const dates = ["2026-4-27", "2026-4-6", "2025-11-11", "2025-11-4"];
    const sorted = [...dates].sort((a, b) => dateSortKey(a) - dateSortKey(b));
    expect(sorted).toEqual(["2025-11-4", "2025-11-11", "2026-4-6", "2026-4-27"]);
  });
});

describe("parseTranscript", () => {
  const speakers: ArcSpeakers = new Map<string, ResolvedSpeaker>([
    ["Gamemaster", { player: "Josh", role: "gm", desc: [] }],
    ["Foral", { player: "Jorge", role: "player", desc: [] }],
  ]);

  test("parses line number, speaker, and text; trims trailing whitespace", () => {
    const { turns } = parseTranscript("000001\tForal: Yo, yo, yo.  ", speakers);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({
      line: 1,
      speaker: "Foral",
      text: "Yo, yo, yo.",
      player: "Jorge",
      role: "player",
    });
  });

  test("leaves player/role undefined for unmapped speakers", () => {
    const { turns } = parseTranscript("000002\tNigel: Hello.", speakers);
    expect(turns[0]?.player).toBeUndefined();
    expect(turns[0]?.role).toBeUndefined();
  });

  test("preserves colons inside the utterance text", () => {
    const { turns } = parseTranscript("000003\tGamemaster: It reads: danger.", speakers);
    expect(turns[0]?.text).toBe("It reads: danger.");
  });

  test("skips blank lines and reports non-empty unparsed lines", () => {
    const text = ["000001\tForal: Hi.", "", "garbage line", "000002\tForal: Bye."].join("\n");
    const { turns, unparsed } = parseTranscript(text, speakers);
    expect(turns).toHaveLength(2);
    expect(unparsed).toEqual([3]);
  });

  test("works without a speaker map (all unresolved)", () => {
    const { turns } = parseTranscript("000001\tForal: Hi.");
    expect(turns[0]?.speaker).toBe("Foral");
    expect(turns[0]?.player).toBeUndefined();
  });
});
