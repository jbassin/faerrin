import { test, expect } from "bun:test"
import { windows, applyGuardrails, judgeSession, type Candidate, type CompleteFn } from "./judge"
import { buildLexiconFrom } from "../lib/lexicon"
import type { FormattedLine, Transcript } from "../lib/types"

function line(text: string, name = "GM"): FormattedLine {
  return { start: "00:00:00", second: 0, text, user: { name, color: "--x" }, duration: 1 }
}
function session(...texts: string[]): Transcript {
  return { date: "d", audio: "", script: texts.map((t) => line(t)) }
}
const lex = buildLexiconFrom(["Tywelwyn", "Hallia"])

test("windows: hybrid keeps only windows containing a flagged line", () => {
  const w = windows(100, new Set([5]), 20, 5, "hybrid")
  expect(w).toHaveLength(1)
  expect(w[0][0]).toBe(0)
})

test("windows: full returns every window", () => {
  expect(windows(40, new Set(), 20, 5, "full").length).toBeGreaterThan(1)
})

test("applyGuardrails drops hallucinated canonical / missing span / bad lineRef and dedupes", () => {
  const t = session("we rode to Twelwyn")
  const cands: Candidate[] = [
    { lineRef: 0, span: "Twelwyn", verdict: "confirm", suggestedCanonical: "Tywelwyn", confidence: 0.9, reason: "x" },
    { lineRef: 0, span: "Twelwyn", verdict: "confirm", suggestedCanonical: "Nonexistent", confidence: 0.9, reason: "x" },
    { lineRef: 0, span: "ZZZ", verdict: "reject", suggestedCanonical: null, confidence: 0.9, reason: "x" },
    { lineRef: 9, span: "Twelwyn", verdict: "confirm", suggestedCanonical: "Tywelwyn", confidence: 0.9, reason: "x" },
  ]
  const out = applyGuardrails(cands, t, lex)
  expect(out).toHaveLength(1)
  expect(out[0].suggestedCanonical).toBe("Tywelwyn")
})

test("applyGuardrails drops a confirm whose canonical already equals the span", () => {
  const t = session("we love Hallia")
  const cands: Candidate[] = [
    { lineRef: 0, span: "Hallia", verdict: "confirm", suggestedCanonical: "Hallia", confidence: 0.9, reason: "x" },
  ]
  expect(applyGuardrails(cands, t, lex)).toHaveLength(0)
})

test("judgeSession runs the stub over windows and applies guardrails", async () => {
  const t = session("intro line", "we rode to Twelwyn at dawn")
  const stub: CompleteFn = async () => ({
    candidates: [
      { lineRef: 1, span: "Twelwyn", verdict: "confirm", suggestedCanonical: "Tywelwyn", confidence: 0.9, reason: "phonetic" },
    ],
  })
  const out = await judgeSession(t, [{ lineRef: 1, span: "Twelwyn" }], lex, {
    completeFn: stub,
    chunkSize: 50,
    overlap: 5,
  })
  expect(out).toHaveLength(1)
  expect(out[0].verdict).toBe("confirm")
})

test("judgeSession escalates borderline confirms; the escalate model's verdict wins", async () => {
  const t = session("we rode to Twelwyn at dawn")
  const calls: string[] = []
  const stub: CompleteFn = async ({ model }) => {
    calls.push(model)
    if (model.includes("haiku")) {
      return { candidates: [{ lineRef: 0, span: "Twelwyn", verdict: "confirm", suggestedCanonical: "Tywelwyn", confidence: 0.6, reason: "borderline" }] }
    }
    return { candidates: [{ lineRef: 0, span: "Twelwyn", verdict: "reject", suggestedCanonical: null, confidence: 0.85, reason: "actually fine" }] }
  }
  const out = await judgeSession(t, [{ lineRef: 0, span: "Twelwyn" }], lex, {
    completeFn: stub,
    judgeModel: "claude-haiku-4-5-20251001",
    escalateModel: "claude-sonnet-4-6",
    chunkSize: 50,
    overlap: 5,
  })
  expect(calls).toHaveLength(2)
  expect(out[0].verdict).toBe("reject")
})
