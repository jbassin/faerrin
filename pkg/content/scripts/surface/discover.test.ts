import { test, expect } from "bun:test"
import { clusterOov, type OovOccurrence } from "./discover"

function occ(fold: string, span: string, date: string, lineRef = 0): OovOccurrence {
  return { fold, span, date, lineRef, lineText: `... ${span} ...` }
}

test("clusters phonetic/spelling variants of a new entity and counts recurrence", () => {
  const byFold = new Map<string, OovOccurrence[]>([
    ["eyestel", [occ("eyestel", "Eyestel", "d1"), occ("eyestel", "Eyestel", "d2")]],
    ["istel", [occ("istel", "Istel", "d2"), occ("istel", "Istel", "d3")]],
  ])
  const clusters = clusterOov(byFold)
  expect(clusters).toHaveLength(1)
  expect(clusters[0].count).toBe(4)
  expect(clusters[0].sessions.sort()).toEqual(["d1", "d2", "d3"])
  // Most frequent surface form is reported first.
  expect(clusters[0].variants[0].count).toBe(2)
})

test("keeps unrelated unknowns in separate clusters", () => {
  const byFold = new Map<string, OovOccurrence[]>([
    ["eyestel", [occ("eyestel", "Eyestel", "d1")]],
    ["zugg", [occ("zugg", "Zugg", "d1")]],
  ])
  expect(clusterOov(byFold)).toHaveLength(2)
})

test("clusters are ranked by total recurrence, descending", () => {
  const byFold = new Map<string, OovOccurrence[]>([
    ["rare", [occ("rare", "Rare", "d1")]],
    ["common", [occ("common", "Common", "d1"), occ("common", "Common", "d2"), occ("common", "Common", "d3")]],
  ])
  const clusters = clusterOov(byFold)
  expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[1].count)
})
