import { test, expect } from "bun:test"
import { ensembleSim, phoneticSim, editSim, phoneticCodes } from "./phonetics"

// Real defs.yaml mistranscription → canonical pairs (spelling-level garbles, the
// class heuristics are meant to catch). Folded inputs.
test("ensembleSim ranks spelling-level garbles of canonicals highly", () => {
  expect(ensembleSim("twelwyn", "tywelwyn")).toBeGreaterThan(0.7)
  expect(ensembleSim("halia", "hallia")).toBeGreaterThan(0.7)
  expect(ensembleSim("barguest", "barghest")).toBeGreaterThan(0.7)
  expect(ensembleSim("sundump", "sundom")).toBeGreaterThan(0.6)
})

test("ensembleSim keeps unrelated words low", () => {
  expect(ensembleSim("banana", "tywelwyn")).toBeLessThan(0.3)
  expect(ensembleSim("yesterday", "barghest")).toBeLessThan(0.4)
})

test("phoneticSim catches sound-alikes that edit distance misses", () => {
  // "feeb" vs "feep": one substitution but phonetically near.
  expect(phoneticSim("feeb", "feep")).toBeGreaterThan(0.5)
})

test("editSim is transposition-aware and bounded", () => {
  expect(editSim("abc", "abc")).toBe(1)
  expect(editSim("", "abc")).toBe(0)
  expect(editSim("ab", "ba")).toBeGreaterThan(0.4)
})

test("phoneticCodes returns a [primary, secondary] pair", () => {
  const [p, s] = phoneticCodes("smith")
  expect(typeof p).toBe("string")
  expect(typeof s).toBe("string")
  expect(p.length).toBeGreaterThan(0)
})
