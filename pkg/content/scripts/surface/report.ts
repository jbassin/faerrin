// Plain-text rendering for the surfacer CLI. JSON output is handled in surface.ts.

import type { KnownCandidate } from "./known"
import type { DiscoveryCluster } from "./discover"

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

export function renderKnown(date: string, cands: KnownCandidate[]): string {
  if (cands.length === 0) return `${date}: no correction candidates`
  const lines = [`${date}: ${cands.length} candidate(s)`]
  for (const c of cands) {
    const hyps = c.hypotheses.map((h) => `${h.canonical} (${h.score.toFixed(2)})`).join(", ")
    lines.push(`  [${c.lineRef}] "${c.span}" → ${hyps}`)
    lines.push(`        ${c.speaker}: ${truncate(c.lineText, 90)}`)
  }
  return lines.join("\n")
}

export function renderClusters(clusters: DiscoveryCluster[]): string {
  if (clusters.length === 0) return "No recurring unknown entities found."
  const lines = [`${clusters.length} recurring unknown cluster(s):`]
  for (const c of clusters) {
    const vs = c.variants.map((v) => `${v.span}×${v.count}`).join(", ")
    lines.push(`  (${c.count} across ${c.sessions.length} session(s)) ${vs}`)
    const ex = c.examples[0]
    if (ex) lines.push(`        e.g. ${ex.date}[${ex.lineRef}]: ${truncate(ex.lineText, 90)}`)
  }
  return lines.join("\n")
}
