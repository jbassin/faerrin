import { test, expect } from "bun:test"
import { foldForMatch, tokenize, ngrams } from "./normalize"

test("foldForMatch strips diacritics and lowercases", () => {
  expect(foldForMatch("Færrin")).toBe("faerrin")
  expect(foldForMatch("Anaïs")).toBe("anais")
  expect(foldForMatch("Fūlwinter")).toBe("fulwinter")
  expect(foldForMatch("Estañion")).toBe("estanion")
})

test("tokenize keeps internal apostrophes and hyphens, drops surrounding punctuation", () => {
  const toks = tokenize("Hey, P'ter and Ki-Rin!")
  expect(toks.map((t) => t.span)).toEqual(["Hey", "P'ter", "and", "Ki-Rin"])
  expect(toks[1].fold).toBe("p'ter")
})

test("tokenize records source offsets", () => {
  const toks = tokenize("the Sundom")
  expect(toks[1].span).toBe("Sundom")
  expect(toks[1].start).toBe(4)
})

test("tokenize captures numbers (for '12 wins' style garbles)", () => {
  const toks = tokenize("we hit 12 wins today")
  expect(toks.map((t) => t.span)).toContain("12")
})

test("ngrams produces 1..n word spans joined by single space", () => {
  const grams = ngrams(tokenize("Second Sun Diner"), 3)
  const spans = grams.map((g) => g.span)
  expect(spans).toContain("Second")
  expect(spans).toContain("Second Sun")
  expect(spans).toContain("Second Sun Diner")
})
