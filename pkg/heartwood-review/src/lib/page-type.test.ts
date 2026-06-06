import { describe, expect, it } from "vitest";
import { detectPageType } from "./page-type.ts";

describe("detectPageType (AC-24)", () => {
  it("Timeline.md → timeline", () => {
    expect(detectPageType("Timeline.md", "<ul><li>...</li></ul>")).toBe(
      "timeline",
    );
  });

  it("deity ` :: ` stat block → deity-statblock", () => {
    const body =
      "**Edicts** :: be bold <br />\n**Anathema** :: cowardice <br />";
    expect(detectPageType("Divinity/Foo.md", body)).toBe("deity-statblock");
  });

  it("<pre> flavor doc → flavor-pre", () => {
    expect(
      detectPageType("Phenomena/Log.md", "<pre>recovered transmission</pre>"),
    ).toBe("flavor-pre");
  });

  it("empty/frontmatter-only → stub", () => {
    expect(
      detectPageType("People/Nobody.md", "---\ntitle: Nobody\n---\n"),
    ).toBe("stub");
  });

  it("literary prose → lore", () => {
    const body =
      "Overlooked by the capital, Sableclutch sends its goods upriver while its power stays elsewhere.";
    expect(detectPageType("Geography/Sableclutch.md", body)).toBe("lore");
  });

  it("hand-authored HTML list (not named Timeline) → timeline", () => {
    const body =
      "<div><ul><li>1066</li><li>1067</li><li>1068</li><li>1069</li></ul></div>";
    expect(detectPageType("Era/Whatever.md", body)).toBe("timeline");
  });
});
