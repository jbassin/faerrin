import { test, expect } from "bun:test"
import { findKnown } from "./known"
import { buildLexiconFrom } from "../lib/lexicon"
import type { FormattedLine, Transcript } from "../lib/types"

function line(text: string, name = "GM"): FormattedLine {
  return { start: "00:00:00", second: 0, text, user: { name, color: "--x" }, duration: 1 }
}
function session(...texts: string[]): Transcript {
  return { date: "d", audio: "", script: texts.map((t) => line(t)) }
}

const lex = buildLexiconFrom(["Tywelwyn", "Hallia", "Dame Quay", "Sundom", "Færrin"])

test("flags a spelling garble of a known canonical with the right hypothesis", () => {
  const cands = findKnown(session("we rode to Twelwyn at dawn"), lex)
  const hit = cands.find((c) => c.span === "Twelwyn")
  expect(hit).toBeDefined()
  expect(hit?.hypotheses[0].canonical).toBe("Tywelwyn")
})

test("matches a diacritic canonical from a folded garble, preserving glyphs", () => {
  const cands = findKnown(session("the city of Farron burns"), lex)
  expect(cands.some((c) => c.hypotheses[0].canonical === "Færrin")).toBe(true)
})

test("does not flag a word that is part of a multi-word canonical", () => {
  // "Hildebrandt" is a token of "Hildebrandt Corporation", so it's correct even
  // though the near-identical "Hildebrant" is also a canonical.
  const lex2 = buildLexiconFrom(["Hildebrandt Corporation", "Hildebrant"])
  const cands = findKnown(session("the Hildebrandt offices were quiet"), lex2)
  expect(cands.some((c) => c.span === "Hildebrandt")).toBe(false)
})

test("does not flag a span that differs from a canonical only by a leading article", () => {
  const lex2 = buildLexiconFrom(["The Master of Ceremonies", "Hildebrandt Corporation"])
  const cands = findKnown(session("we met the Master of Ceremonies today"), lex2)
  expect(cands.some((c) => c.hypotheses[0].canonical === "The Master of Ceremonies")).toBe(false)
})

test("does not flag a span that differs from a canonical only by a leading determiner", () => {
  // "other Harlequins" is the canonical "The Harlequins" with a swapped determiner,
  // not a mistranscription — the distinctive word "Harlequins" is spelled correctly.
  const lex2 = buildLexiconFrom(["The Harlequins"])
  const cands = findKnown(session("it looks like the other Harlequins were there"), lex2)
  expect(cands.some((c) => c.hypotheses[0].canonical === "The Harlequins")).toBe(false)
})

test("still flags a multi-word span with a real content difference (Corp vs Corporation)", () => {
  const lex2 = buildLexiconFrom(["The Master of Ceremonies", "Hildebrandt Corporation"])
  const cands = findKnown(session("the Hildebrandt Corp building burned"), lex2)
  expect(cands.some((c) => c.hypotheses[0].canonical === "Hildebrandt Corporation")).toBe(true)
})

test("does not flag ordinary English words", () => {
  expect(findKnown(session("we rode to the castle at dawn"), lex)).toHaveLength(0)
})

test("flags a multi-word garble against a multi-word canonical", () => {
  const cands = findKnown(session("meet me at Dame Key tonight"), lex)
  expect(cands.some((c) => c.hypotheses[0].canonical === "Dame Quay")).toBe(true)
})

test("dedupes by (lineRef, span)", () => {
  const cands = findKnown(session("Twelwyn Twelwyn again"), lex)
  expect(cands.filter((c) => c.span === "Twelwyn")).toHaveLength(1)
})
