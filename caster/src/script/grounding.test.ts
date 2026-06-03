import { test, expect, describe } from "bun:test";
import type { SessionDigest, WikiCorpus, WikiPage } from "../types.ts";
import { groundDigest } from "./grounding.ts";

function corpus(pages: WikiPage[]): WikiCorpus {
  return { pages: new Map(pages.map((p) => [p.path, p])), graph: new Map() };
}

const wiki = corpus([
  { path: "Org/Pale Lantern Society.md", title: "Pale Lantern Society", text: "Undead physicians.", links: [] },
  { path: "Phenomena/Harmony/Voidsong.md", title: "Voidsong", text: "A cry from beyond the wall.", links: [] },
  { path: "Geography/Calaria/index.md", title: "Calaria", text: "A nation.", links: [] },
]);

const digest: SessionDigest = {
  sessionId: "x",
  synopsis: "s",
  discarded: [],
  beats: [
    { order: 1, summary: "b1", characters: [], locations: [], wikiRefs: ["Voidsong", "Letov Obratz"] },
    { order: 2, summary: "b2", characters: [], locations: [], wikiRefs: ["pale lantern society", "Voidsong"] },
  ],
};

describe("groundDigest", () => {
  const entries = groundDigest(digest, wiki);

  test("matches refs to pages case-insensitively, drops unmatched (NPC) refs", () => {
    const titles = entries.map((e) => e.title);
    expect(titles).toContain("Voidsong");
    expect(titles).toContain("Pale Lantern Society");
    expect(titles).not.toContain("Calaria"); // never referenced
    // "Letov Obratz" has no page → no entry
    expect(entries).toHaveLength(2);
  });

  test("dedupes a page referenced from multiple beats and aggregates refs", () => {
    const voidsong = entries.find((e) => e.title === "Voidsong")!;
    expect(voidsong.refs).toEqual(["Voidsong"]); // "Voidsong" twice → one ref entry
    expect(voidsong.text).toBe("A cry from beyond the wall.");
  });

  test("orders entries by first appearance across beats", () => {
    expect(entries[0]?.title).toBe("Voidsong"); // appears in beat 1 first
  });
});
