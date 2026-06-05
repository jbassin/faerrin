import { test, expect } from "bun:test"
import { buildLexiconFrom, buildLexicon } from "./lexicon"

const FIXTURE = ["Tywelwyn", "Hallia", "Færrin", "Sundom", "Dame Quay", "barghest"]

test("buildLexiconFrom folds canonicals and dedupes", () => {
  const lex = buildLexiconFrom([...FIXTURE, "tywelwyn"]) // dup by fold
  expect(lex.entries.length).toBe(FIXTURE.length)
  expect(lex.has("faerrin")).toBe(true) // matched via fold
  expect(lex.has("tywelwyn")).toBe(true)
})

test("nearest returns the right canonical for a garble, above floor", () => {
  const lex = buildLexiconFrom(FIXTURE)
  const hits = lex.nearest("twelwyn", 5, 0.5)
  expect(hits[0].canonical).toBe("Tywelwyn")
  expect(hits[0].score).toBeGreaterThan(0.7)
})

test("nearest preserves canonical glyphs in the suggestion", () => {
  const lex = buildLexiconFrom(FIXTURE)
  const hits = lex.nearest("farron", 3, 0.4)
  expect(hits.map((h) => h.canonical)).toContain("Færrin")
})

test("nearest returns nothing for clearly unrelated tokens", () => {
  const lex = buildLexiconFrom(FIXTURE)
  expect(lex.nearest("computer", 5, 0.5)).toHaveLength(0)
})

test("isToken recognizes words inside multi-word canonicals", () => {
  const lex = buildLexiconFrom(["Hildebrandt Corporation", "Hildebrant"])
  expect(lex.isToken("hildebrandt")).toBe(true) // token of the wiki canonical
  expect(lex.isToken("corporation")).toBe(true)
  expect(lex.has("hildebrandt")).toBe(false) // not a whole canonical on its own
  expect(lex.isToken("nonsense")).toBe(false)
})

test("buildLexicon reads the real defs + wiki and yields a substantial lexicon", async () => {
  const lex = await buildLexicon()
  expect(lex.entries.length).toBeGreaterThan(100)
  // A canonical that exists in the real defs.yaml.
  expect(lex.has("tywelwyn")).toBe(true)
})
