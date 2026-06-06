import { describe, expect, it } from "vitest";
import { voiceWarnings } from "./voice-warnings.ts";

const types = (t: string) => voiceWarnings(t).map((w) => w.type);

describe("voiceWarnings (§9 automatable subset, AC-9)", () => {
  it("flags the encyclopedia opener", () => {
    expect(
      types("Sablecrux is a large scrapyard located in the district."),
    ).toContain("encyclopedia-opener");
  });

  it("flags filler intensifiers", () => {
    expect(types("The vast, expansive yard holds many things.")).toContain(
      "intensifier",
    );
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

  it("suppresses literary checks on non-prose page types (AC-24)", () => {
    const statline = "Foo is a large thing.";
    expect(voiceWarnings(statline, { pageType: "deity-statblock" })).toEqual(
      [],
    );
    // but still applies on a stub (graduates to prose)
    expect(
      voiceWarnings(statline, { pageType: "stub" }).map((w) => w.type),
    ).toContain("encyclopedia-opener");
  });

  it("flags broken [[wikilinks]] against allSlugs (AC-13)", () => {
    // basename resolution (shortest) for "Maren Dock" → "Maren-Dock"; full-path for the index.
    const slugs = ["Geography/Calaria/Hallia/index", "People/Maren-Dock"];
    const warns = voiceWarnings(
      "See [[Maren Dock]], [[Geography/Calaria/Hallia/index|Hallia]], and [[Nonexistent Place]].",
      { allSlugs: slugs },
    );
    const broken = warns.find((w) => w.type === "broken-wikilink");
    expect(broken?.message).toContain("Nonexistent Place");
    expect(broken?.message).not.toContain("Maren Dock");
    expect(broken?.message).not.toContain("Hallia");
  });
});
