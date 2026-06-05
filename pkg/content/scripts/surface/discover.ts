// Mode 2 — new-entity discovery. Collects OOV tokens that match NOTHING in the
// lexicon (so they're not Mode-1 garbles of a known term), clusters the variants
// against each other, and ranks clusters by cross-session recurrence. This is what
// catches a brand-new entity like "Eyestel"/"Istel" whose canonical doesn't exist
// yet — the recurrence signal separates real new names from one-off mis-hearings.

import { BKTree } from "mnemonist"
import damerau from "damerau-levenshtein"
import { surface } from "../config"
import { isEnglish, isOov } from "../lib/english"
import { tokenize } from "../lib/normalize"
import { ensembleSim, phoneticCodes } from "../lib/phonetics"
import type { Lexicon } from "../lib/lexicon"
import { listSessionDates, readSession } from "./tokens"

export interface OovOccurrence {
  fold: string
  span: string
  date: string
  lineRef: number
  lineText: string
}

export interface DiscoveryCluster {
  /** Distinct surface spans in the cluster, most frequent first. */
  variants: { span: string; count: number }[]
  /** Total occurrences across all sessions. */
  count: number
  /** Sessions the cluster appears in. */
  sessions: string[]
  /** A few example occurrences for context. */
  examples: { date: string; lineRef: number; lineText: string }[]
}

const ORDINAL = /^\d+(st|nd|rd|th)$/ // 13th, 60th
const DICE = /^\d*d\d+s?$/ // d20, 2d8, d10s
const DECADE = /^\d+s$/ // 20s, 1960s
// Filler/interjection: only vowels + h/m/w, optionally hyphenated (mm-hmm, uh-huh, ahhh).
const FILLER = /^[aeiouhmw]+(?:['’-][aeiouhmw]+)*$/
const WEEKDAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
const MONTHS = new Set([
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
])

/** Common transcript noise that is OOV but not a candidate new entity. */
function looksLikeNoise(fold: string): boolean {
  if (ORDINAL.test(fold) || DICE.test(fold) || DECADE.test(fold)) return true
  if (FILLER.test(fold)) return true
  if (WEEKDAYS.has(fold) || MONTHS.has(fold)) return true
  if (fold.includes("-")) {
    const parts = fold.split("-").filter(Boolean)
    if (parts.length > 1 && parts.every((p) => isEnglish(p) || /^\d+$/.test(p))) return true
  }
  return false
}

/** Gather OOV tokens that are not near any known canonical, keyed by folded form. */
export async function collectOov(
  lex: Lexicon,
  dates: string[],
): Promise<Map<string, OovOccurrence[]>> {
  const byFold = new Map<string, OovOccurrence[]>()
  for (const date of dates) {
    const t = await readSession(date)
    if (!t) continue
    t.script.forEach((line, lineRef) => {
      for (const tok of tokenize(line.text)) {
        const fold = tok.fold
        if (fold.length < surface.minTokenLen) continue
        if (!isOov(fold) || lex.has(fold) || lex.isToken(fold)) continue
        if (looksLikeNoise(fold)) continue
        // Near a known canonical → a Mode-1 garble, not a new entity. Skip.
        if (lex.nearest(fold, 1, surface.knownNearFloor).length > 0) continue
        const arr = byFold.get(fold) ?? []
        arr.push({ fold, span: tok.span, date, lineRef, lineText: line.text })
        byFold.set(fold, arr)
      }
    })
  }
  return byFold
}

/**
 * Leader clustering: process OOV folds most-frequent-first; attach each to the
 * best-matching existing cluster representative (≥ merge floor) or start a new one.
 * Comparing only against representatives — not transitively — avoids chaining
 * distinct entities ("Henrik" and "Cedric") into one mega-cluster.
 */
export function clusterOov(byFold: Map<string, OovOccurrence[]>): DiscoveryCluster[] {
  const folds = [...byFold.keys()].sort(
    (a, b) => (byFold.get(b) as OovOccurrence[]).length - (byFold.get(a) as OovOccurrence[]).length,
  )

  interface Cluster {
    rep: string
    members: string[]
    code: string
  }
  const clusters: Cluster[] = []
  const byCode = new Map<string, Cluster[]>() // primary phonetic code of rep → clusters
  const repToCluster = new Map<string, Cluster>()
  const repTree = new BKTree<string>((a, b) => damerau(a, b).steps)

  for (const f of folds) {
    const code = phoneticCodes(f)[0] || ""

    // Candidate clusters: reps in the same phonetic bucket, or reps within a small
    // edit distance (catches phonetic-different but spelling-near variants).
    const cands = new Set<Cluster>(byCode.get(code) ?? [])
    if (clusters.length > 0) {
      for (const { item } of repTree.search(2, f) as Iterable<{ item: string; distance: number }>) {
        const c = repToCluster.get(item)
        if (c) cands.add(c)
      }
    }

    let bestCluster: Cluster | null = null
    let bestScore = 0
    for (const c of cands) {
      const s = ensembleSim(f, c.rep)
      if (s >= surface.clusterMergeFloor && s > bestScore) {
        bestScore = s
        bestCluster = c
      }
    }

    if (bestCluster) {
      bestCluster.members.push(f)
    } else {
      const c: Cluster = { rep: f, members: [f], code }
      clusters.push(c)
      repToCluster.set(f, c)
      const arr = byCode.get(code) ?? []
      arr.push(c)
      byCode.set(code, arr)
      repTree.add(f)
    }
  }

  return clusters
    .map((c) => summarize(c.members, byFold))
    .sort((a, b) => b.count - a.count)
}

function summarize(members: string[], byFold: Map<string, OovOccurrence[]>): DiscoveryCluster {
  const occ = members.flatMap((m) => byFold.get(m) as OovOccurrence[])
  const spanCounts = new Map<string, number>()
  for (const o of occ) spanCounts.set(o.span, (spanCounts.get(o.span) ?? 0) + 1)
  const variants = [...spanCounts.entries()]
    .map(([span, count]) => ({ span, count }))
    .sort((a, b) => b.count - a.count)
  const sessions = [...new Set(occ.map((o) => o.date))]
  const examples = occ.slice(0, 3).map((o) => ({ date: o.date, lineRef: o.lineRef, lineText: o.lineText }))
  return { variants, count: occ.length, sessions, examples }
}

/** Full Mode-2 run: collect OOV across sessions, cluster, filter by recurrence. */
export async function discover(
  lex: Lexicon,
  opts: { minCount?: number; dates?: string[] } = {},
): Promise<DiscoveryCluster[]> {
  const dates = opts.dates ?? (await listSessionDates())
  const byFold = await collectOov(lex, dates)
  const min = opts.minCount ?? surface.minClusterCount
  return clusterOov(byFold).filter((c) => c.count >= min)
}
