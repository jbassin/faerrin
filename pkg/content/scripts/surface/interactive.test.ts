import { test, expect } from "bun:test"
import {
  parseAction,
  reviewKnown,
  reviewClusters,
  annotationKey,
  dedupeForReview,
  type Annotations,
  type ReviewDeps,
} from "./interactive"
import type { KnownCandidate } from "./known"
import type { DiscoveryCluster } from "./discover"

test("parseAction maps inputs to actions", () => {
  expect(parseAction("", 2)).toEqual({ kind: "approve", index: 0 })
  expect(parseAction("a", 2)).toEqual({ kind: "approve", index: 0 })
  expect(parseAction("2", 2)).toEqual({ kind: "approve", index: 1 })
  expect(parseAction("3", 2)).toBeNull() // out of range for 2 hypotheses
  expect(parseAction("c", 2)).toEqual({ kind: "change" })
  expect(parseAction("d", 2)).toEqual({ kind: "deny" })
  expect(parseAction("q", 2)).toEqual({ kind: "quit" })
  expect(parseAction("zzz", 2)).toBeNull()
})

const fold = (s: string) => s.toLowerCase()
const none = () => false

test("dedupeForReview collapses repeats of the same span (incl. across sessions)", () => {
  const seen = new Set<string>()
  const a = dedupeForReview([cand("Hildebrandt", "Hildebrant"), cand("Hildebrandt", "Hildebrant")], seen, fold, none)
  expect(a).toHaveLength(1)
  // a later session re-using the span yields nothing
  const b = dedupeForReview([cand("Hildebrandt", "Hildebrant")], seen, fold, none)
  expect(b).toHaveLength(0)
})

test("dedupeForReview drops spans already covered by defs.yaml", () => {
  const seen = new Set<string>()
  const isCovered = (span: string) => span === "Hildebrandt"
  const out = dedupeForReview([cand("Hildebrandt", "Hildebrant"), cand("Twelwyn", "Tywelwyn")], seen, fold, isCovered)
  expect(out.map((c) => c.span)).toEqual(["Twelwyn"])
})

function makeDeps(answers: string[]) {
  const applied: { canonical: string; span: string }[] = []
  const q = [...answers]
  const deps: ReviewDeps = {
    ask: async () => q.shift() ?? "q",
    apply: async (canonical, span) => {
      applied.push({ canonical, span })
      return { added: true }
    },
    out: () => {},
  }
  return { deps, applied }
}

function cand(span: string, canonical: string): KnownCandidate {
  return {
    lineRef: 0,
    span,
    speaker: "GM",
    lineText: `... ${span} ...`,
    hypotheses: [{ canonical, score: 0.9 }],
  }
}

test("reviewKnown applies an approved top hypothesis", async () => {
  const { deps, applied } = makeDeps([""])
  const stats = await reviewKnown([cand("Twelwyn", "Tywelwyn")], deps)
  expect(applied).toEqual([{ canonical: "Tywelwyn", span: "Twelwyn" }])
  expect(stats.applied).toBe(1)
})

test("reviewKnown 'change' prompts for a custom canonical", async () => {
  const { deps, applied } = makeDeps(["c", "Custom Name"])
  await reviewKnown([cand("Twelwyn", "Tywelwyn")], deps)
  expect(applied).toEqual([{ canonical: "Custom Name", span: "Twelwyn" }])
})

test("reviewKnown 'deny' writes nothing", async () => {
  const { deps, applied } = makeDeps(["d"])
  const stats = await reviewKnown([cand("Twelwyn", "Tywelwyn")], deps)
  expect(applied).toHaveLength(0)
  expect(stats.denied).toBe(1)
})

test("reviewKnown 'quit' stops the loop early", async () => {
  const { deps, applied } = makeDeps(["q"])
  const stats = await reviewKnown([cand("A", "X"), cand("B", "Y")], deps)
  expect(stats.quit).toBe(true)
  expect(applied).toHaveLength(0)
})

test("reviewKnown re-prompts on unrecognized input", async () => {
  const { deps, applied } = makeDeps(["zzz", "a"])
  await reviewKnown([cand("Twelwyn", "Tywelwyn")], deps)
  expect(applied).toHaveLength(1)
})

test("reviewKnown shows the LLM judge note when annotations are supplied", async () => {
  const out: string[] = []
  const deps: ReviewDeps = {
    ask: async () => "d", // deny so we just inspect the rendered output
    apply: async () => ({ added: true }),
    out: (s) => out.push(s),
  }
  const ann: Annotations = new Map([
    [
      annotationKey(0, "Twelwyn"),
      { verdict: "confirm", confidence: 0.92, reason: "phonetic + context", suggestedCanonical: "Tywelwyn" },
    ],
  ])
  await reviewKnown([cand("Twelwyn", "Tywelwyn")], deps, ann)
  expect(out.join("\n")).toContain("judge: confirm → Tywelwyn (0.92)")
})

function cluster(variants: [string, number][]): DiscoveryCluster {
  return {
    variants: variants.map(([span, count]) => ({ span, count })),
    count: variants.reduce((n, [, c]) => n + c, 0),
    sessions: ["d1", "d2"],
    examples: [{ date: "d1", lineRef: 0, lineText: "x" }],
  }
}

test("reviewClusters records every variant under the typed canonical", async () => {
  const { deps, applied } = makeDeps(["Istel"])
  await reviewClusters([cluster([["Eyestel", 3], ["Istel", 2]])], deps)
  expect(applied.map((a) => a.span).sort()).toEqual(["Eyestel", "Istel"])
  expect(applied.every((a) => a.canonical === "Istel")).toBe(true)
})

test("reviewClusters default accepts the most frequent variant", async () => {
  const { deps, applied } = makeDeps([""])
  await reviewClusters([cluster([["Eyestel", 3], ["Istel", 2]])], deps)
  expect(applied.every((a) => a.canonical === "Eyestel")).toBe(true)
})

test("reviewClusters 'deny' skips the cluster", async () => {
  const { deps, applied } = makeDeps(["d"])
  const stats = await reviewClusters([cluster([["Eyestel", 3]])], deps)
  expect(applied).toHaveLength(0)
  expect(stats.denied).toBe(1)
})
