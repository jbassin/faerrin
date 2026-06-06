import { describe, expect, it } from "vitest";
import { parseTranscriptRange } from "./sessions.ts";

const SAMPLE = [
  "000050\tGamemaster: Sableclutch hugs the south bank.",
  "000051\tArgyle: The warehouses never sleep.",
  "000052\tGamemaster: Cargo first lands here.",
  "000053\tJohnny: unrelated banter",
  "garbage line without id",
].join("\n");

describe("parseTranscriptRange (AC-3 local citation lookup)", () => {
  it("returns only lines within [start, end] with speaker + text split", () => {
    const got = parseTranscriptRange(SAMPLE, 50, 52);
    expect(got).toEqual([
      { id: 50, speaker: "Gamemaster", text: "Sableclutch hugs the south bank." },
      { id: 51, speaker: "Argyle", text: "The warehouses never sleep." },
      { id: 52, speaker: "Gamemaster", text: "Cargo first lands here." },
    ]);
  });

  it("excludes lines outside the range and unparseable lines", () => {
    const got = parseTranscriptRange(SAMPLE, 53, 53);
    expect(got).toEqual([{ id: 53, speaker: "Johnny", text: "unrelated banter" }]);
  });

  it("returns empty for a range with no lines", () => {
    expect(parseTranscriptRange(SAMPLE, 900, 999)).toEqual([]);
  });
});
