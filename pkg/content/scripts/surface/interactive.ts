// Interactive review for the surfacer. Pure decision parsing + I/O-injected review
// loops, so the logic is unit-testable without a real terminal. The CLI
// (surface.ts) wires `ask` to readline and `apply` to defs.addCorrection.

import type { KnownCandidate } from "./known"
import type { DiscoveryCluster } from "./discover"
import { color } from "../lib/color"

export interface ReviewDeps {
  /** Prompt and return a single keystroke (no Enter needed) — for actions. */
  key(prompt: string): Promise<string>
  /** Prompt and return a full line (Enter-terminated) — for typed text. */
  line(prompt: string): Promise<string>
  /** Persist a correction; returns whether a new entry was written. */
  apply(canonical: string, span: string): Promise<{ added: boolean; reason?: string }>
  /** Emit a line of output. */
  out(line: string): void
}

export interface ReviewStats {
  reviewed: number
  approved: number
  applied: number
  denied: number
  quit: boolean
}

function emptyStats(): ReviewStats {
  return { reviewed: 0, approved: 0, applied: 0, denied: 0, quit: false }
}

export type Action =
  | { kind: "approve"; index: number } // approve hypotheses[index]
  | { kind: "change" } // enter a custom canonical
  | { kind: "deny" }
  | { kind: "quit" }

/**
 * Parse a keystroke/line into an action for a candidate with `hypCount` hypotheses.
 * "" / a / y → approve top; 1..9 → approve that hypothesis (if it exists);
 * c → change; d / n / s → deny; q → quit. Unknown input → null (re-prompt).
 */
export function parseAction(input: string, hypCount: number): Action | null {
  const s = input.trim().toLowerCase()
  if (s === "" || s === "a" || s === "y") return { kind: "approve", index: 0 }
  if (/^[1-9]$/.test(s)) {
    const i = Number(s) - 1
    return i < hypCount ? { kind: "approve", index: i } : null
  }
  if (s === "c") return { kind: "change" }
  if (s === "d" || s === "n" || s === "s") return { kind: "deny" }
  if (s === "q") return { kind: "quit" }
  return null
}

function clip(s: string, n = 100): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

/**
 * Drop candidates whose span was already handled this review (tracked in `seen`,
 * keyed by folded span) or is already a known mistranscription (`isCovered`). So a
 * span the user already decided on never re-appears on a later line/session, and
 * corrections already in defs.yaml aren't re-surfaced. Mutates `seen`.
 */
export function dedupeForReview(
  items: KnownCandidate[],
  seen: Set<string>,
  fold: (s: string) => string,
  isCovered: (span: string) => boolean,
): KnownCandidate[] {
  const out: KnownCandidate[] = []
  for (const c of items) {
    const key = fold(c.span)
    if (seen.has(key)) continue
    if (isCovered(c.span)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** An LLM judge's take on a candidate, shown inline when `--judge` is used. */
export interface JudgeNote {
  verdict: "confirm" | "new" | "reject"
  confidence: number
  reason: string
  suggestedCanonical: string | null
}

export type Annotations = Map<string, JudgeNote>

/** Stable key matching a candidate span to its judge note (lineRef + folded span). */
export function annotationKey(lineRef: number, span: string): string {
  return `${lineRef} ${span.replace(/\s+/g, " ").trim().toLowerCase()}`
}

const verdictColor: Record<JudgeNote["verdict"], (s: string) => string> = {
  confirm: color.green,
  new: color.yellow,
  reject: color.red,
}

function formatNote(n: JudgeNote): string {
  const target = n.verdict === "confirm" && n.suggestedCanonical ? ` → ${n.suggestedCanonical}` : ""
  const verdict = verdictColor[n.verdict](n.verdict)
  return color.dim(`   judge: ${verdict}${target} (${n.confidence.toFixed(2)}) — ${n.reason}`)
}

function formatKnown(c: KnownCandidate, note?: JudgeNote): string {
  const lines = [
    "",
    `${color.gray(`[${c.lineRef}]`)} ${color.cyan(c.speaker)}: ${color.yellow(`"${c.span}"`)}`,
    color.dim(`   ${clip(c.lineText)}`),
    ...c.hypotheses.map(
      (h, i) => `   ${color.bold(`${i + 1})`)} ${color.green(h.canonical)}  ${color.dim(`(${h.score.toFixed(2)})`)}`,
    ),
  ]
  if (note) lines.push(formatNote(note))
  return lines.join("\n")
}

const KNOWN_PROMPT =
  "  " +
  [
    `${color.bold("a")}/${color.bold("⏎")} approve`,
    `${color.bold("1-N")} pick`,
    `${color.bold("c")} change`,
    `${color.bold("d")} deny`,
    `${color.bold("q")} quit`,
  ].join(" · ") +
  " > "

/** Review Mode-1 candidates: approve/change/deny each, applying approvals to defs.yaml. */
export async function reviewKnown(
  items: KnownCandidate[],
  deps: ReviewDeps,
  annotations?: Annotations,
): Promise<ReviewStats> {
  const stats = emptyStats()
  if (items.length === 0) {
    deps.out("Nothing to review.")
    return stats
  }
  deps.out(color.bold(`Reviewing ${items.length} candidate(s).`))

  for (const c of items) {
    deps.out(formatKnown(c, annotations?.get(annotationKey(c.lineRef, c.span))))

    let action: Action | null = null
    while (action === null) {
      action = parseAction(await deps.key(KNOWN_PROMPT), c.hypotheses.length)
      if (action === null) deps.out(color.red("   ? unrecognized — a/enter, 1-N, c, d, or q"))
    }

    if (action.kind === "quit") {
      stats.quit = true
      break
    }
    stats.reviewed++
    if (action.kind === "deny") {
      stats.denied++
      continue
    }

    let canonical: string
    if (action.kind === "change") {
      canonical = (await deps.line("   correct form > ")).trim()
      if (!canonical) {
        deps.out(color.dim("   (empty — skipped)"))
        stats.denied++
        continue
      }
    } else {
      canonical = c.hypotheses[action.index].canonical
    }

    stats.approved++
    const res = await deps.apply(canonical, c.span)
    if (res.added) {
      stats.applied++
      deps.out(color.green(`   ✓ "${c.span}" → ${canonical}`))
    } else {
      deps.out(color.dim(`   • not written (${res.reason})`))
    }
  }

  return stats
}

function formatCluster(c: DiscoveryCluster): string {
  const variants = c.variants.map((v) => `${color.yellow(v.span)}${color.dim(`×${v.count}`)}`).join(", ")
  const ex = c.examples[0]
  return [
    "",
    `${color.cyan(`(${c.count} across ${c.sessions.length} session(s))`)} ${variants}`,
    ex ? color.dim(`   e.g. ${ex.date}[${ex.lineRef}]: ${clip(ex.lineText)}`) : "",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Review Mode-2 discovery clusters. For each, the user names the canonical (default
 * = most frequent variant), and every variant span is recorded as a mistranscription
 * of it. addCorrection skips the variant equal to the canonical and any duplicates.
 */
export async function reviewClusters(clusters: DiscoveryCluster[], deps: ReviewDeps): Promise<ReviewStats> {
  const stats = emptyStats()
  if (clusters.length === 0) {
    deps.out("No clusters to review.")
    return stats
  }
  deps.out(color.bold(`Reviewing ${clusters.length} cluster(s).`))

  for (const c of clusters) {
    deps.out(formatCluster(c))
    const dflt = c.variants[0]?.span ?? ""
    const prompt =
      `   canonical [${color.green(dflt)}] (` +
      [`${color.bold("⏎")} accept`, "name", `${color.bold("d")} deny`, `${color.bold("q")} quit`].join(" · ") +
      ") > "
    const input = (await deps.line(prompt)).trim()
    const lower = input.toLowerCase()

    if (lower === "q") {
      stats.quit = true
      break
    }
    stats.reviewed++
    if (lower === "d") {
      stats.denied++
      continue
    }

    const canonical = input === "" ? dflt : input
    if (!canonical) {
      stats.denied++
      continue
    }
    stats.approved++
    for (const v of c.variants) {
      const res = await deps.apply(canonical, v.span)
      if (res.added) {
        stats.applied++
        deps.out(color.green(`   ✓ "${v.span}" → ${canonical}`))
      }
    }
  }

  return stats
}
