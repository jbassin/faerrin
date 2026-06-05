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
