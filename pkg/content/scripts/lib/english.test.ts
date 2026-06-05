import { test, expect } from "bun:test"
import { isEnglish, isOov } from "./english"

test("common English words are recognized, not flagged OOV", () => {
  for (const w of ["the", "giant", "war", "yesterday", "scale"]) {
    expect(isEnglish(w)).toBe(true)
    expect(isOov(w)).toBe(false)
  }
})

test("invented proper nouns are flagged OOV", () => {
  // Note: barghest / widdershins are real dictionary words — their *garbles* are
  // what get flagged, not the canonical itself. These are all genuinely invented.
  for (const w of ["sbrtlby", "tywelwyn", "faerrin", "anais", "zugg", "ugathal", "raelion"]) {
    expect(isOov(w)).toBe(true)
  }
})

test("plural/possessive of English words is not flagged", () => {
  expect(isOov("giants")).toBe(false)
  expect(isOov("herald's")).toBe(false)
})

test("pure numbers and empties are not flagged", () => {
  expect(isOov("12")).toBe(false)
  expect(isOov("8:15")).toBe(false)
  expect(isOov("")).toBe(false)
})
