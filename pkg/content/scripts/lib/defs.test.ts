import { test, expect } from "bun:test"
import { escapeRegex, toFragment, addCorrection } from "./defs"

test("escapeRegex escapes regex metacharacters", () => {
  expect(escapeRegex("P.O. Box")).toBe("P\\.O\\. Box")
  expect(escapeRegex("a+b")).toBe("a\\+b")
})

test("toFragment escapes metachars and generalizes inter-word whitespace", () => {
  expect(toFragment("Dame Key")).toBe("Dame\\s*Key")
  expect(toFragment("P. O. Box")).toBe("P\\.\\s*O\\.\\s*Box")
})

test("addCorrection adds a new escaped + generalized fragment", async () => {
  const doc: Record<string, string[]> = {}
  const r = await addCorrection("Tywelwyn", "12 wins", doc)
  expect(r.added).toBe(true)
  expect(doc["Tywelwyn"]).toEqual(["12\\s*wins"])
})

test("addCorrection appends to an existing canonical", async () => {
  const doc: Record<string, string[]> = { Tywelwyn: ["Twelwyn"] }
  await addCorrection("Tywelwyn", "Dwellwyn", doc)
  expect(doc["Tywelwyn"]).toEqual(["Twelwyn", "Dwellwyn"])
})

test("addCorrection dedupes an identical fragment", async () => {
  const doc: Record<string, string[]> = { Tywelwyn: ["Twelwyn"] }
  const r = await addCorrection("Tywelwyn", "Twelwyn", doc)
  expect(r.added).toBe(false)
  expect(r.reason).toBe("duplicate")
})

test("addCorrection skips a span already covered by an existing regex fragment", async () => {
  // "pyrolight" (no space) isn't an identical fragment, but the existing \s* pattern matches it.
  const doc: Record<string, string[]> = { Pyrelight: ["pyro\\s*light"] }
  const r = await addCorrection("Pyrelight", "pyrolight", doc)
  expect(r.added).toBe(false)
  expect(r.reason).toBe("already covered")
})

test("addCorrection refuses a variant equal to its canonical", async () => {
  const doc: Record<string, string[]> = {}
  const r = await addCorrection("Sundom", "Sundom", doc)
  expect(r.added).toBe(false)
  expect(r.reason).toBe("variant equals canonical")
})
