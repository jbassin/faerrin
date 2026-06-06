import { describe, expect, it } from "vitest";
import { voiceWarnings } from "./voice-warnings.ts";

const types = (t: string) => voiceWarnings(t).map((w) => w.type);

describe("voiceWarnings (§9 automatable subset, AC-9)", () => {
  it("flags the encyclopedia opener", () => {
    expect(types("Sablecrux is a large scrapyard located in the district.")).toContain(
      "encyclopedia-opener",
    );
  });

  it("flags filler intensifiers", () => {
    expect(types("The vast, expansive yard holds many things.")).toContain("intensifier");
  });

  it('flags an "It is …" second sentence', () => {
    expect(
      types("The yard sprawls along the river. It is full of scrap."),
    ).toContain("it-is-template");
  });

  it("passes good, perspectival prose with no warnings", () => {
    const good =
      "Sableclutch is overlooked by the rest of the capital — its goods leave, but its power does not.";
    // The opener regex would catch "Sableclutch is" + a word, so use voice that
    // doesn't start with the dictionary cadence:
    const better =
      "Overlooked by the rest of the capital, Sableclutch sends its goods upriver while its power stays elsewhere.";
    expect(voiceWarnings(better)).toEqual([]);
    void good;
  });

  it("reports empty prose", () => {
    expect(types("   ")).toEqual(["empty"]);
  });
});
