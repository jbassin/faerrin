import { test, expect, describe } from "bun:test";
import type { WikiPage } from "../types.ts";
import { buildCorpus, cleanWiki, titleFromPath } from "./wiki.ts";

describe("cleanWiki", () => {
  test("reads frontmatter title and strips the frontmatter block", () => {
    const { title, text } = cleanWiki("---\ntitle: Heart of Hearts\n---\n\nBody here.", "index.md");
    expect(title).toBe("Heart of Hearts");
    expect(text).toBe("Body here.");
  });

  test("falls back to a path-derived title when no frontmatter", () => {
    const { title } = cleanWiki("Just text.", "Geography/Calaria/Wrenford.md");
    expect(title).toBe("Wrenford");
  });

  test("collects wikilink targets and drops aliases", () => {
    const { links } = cleanWiki(
      "Built by [[Org/index|Orgs]] near [[Verdant Expanse]] and [[Verdant Expanse]] again.",
      "x.md",
    );
    expect(links).toEqual(["Org/index", "Verdant Expanse"]);
  });

  test("strips embedded HTML and comments", () => {
    const { text } = cleanWiki(
      "Before <pre style='x'>noise</pre> <!-- hi --> after.",
      "x.md",
    );
    expect(text).not.toContain("<pre");
    expect(text).not.toContain("<!--");
    expect(text).toContain("Before");
    expect(text).toContain("after.");
  });
});

describe("titleFromPath", () => {
  test("uses parent directory name for index.md", () => {
    expect(titleFromPath("Geography/Calaria/index.md")).toBe("Calaria");
  });

  test("uses filename otherwise", () => {
    expect(titleFromPath("Org/Hollowpact.md")).toBe("Hollowpact");
  });
});

describe("buildCorpus", () => {
  const pages: WikiPage[] = [
    { path: "Geography/Calaria/Wrenford.md", title: "Wrenford", text: "", links: ["Verdant Expanse", "Green Father"] },
    { path: "Geography/Calaria/Verdant Expanse.md", title: "Verdant Expanse", text: "", links: [] },
    { path: "Divinity/Green Father.md", title: "Green Father", text: "", links: ["Wrenford"] },
  ];
  const { graph } = buildCorpus(pages);

  test("resolves links by basename and by title", () => {
    expect(graph.get("Geography/Calaria/Wrenford.md")).toEqual([
      "Geography/Calaria/Verdant Expanse.md",
      "Divinity/Green Father.md",
    ]);
  });

  test("drops unresolvable and self links", () => {
    const withMissing: WikiPage[] = [
      { path: "A.md", title: "A", text: "", links: ["Nonexistent", "A"] },
    ];
    expect(buildCorpus(withMissing).graph.get("A.md")).toEqual([]);
  });
});
