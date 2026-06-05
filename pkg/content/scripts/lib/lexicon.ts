// The canonical lexicon: every known correct proper noun, drawn from defs.yaml
// keys (the corrections SSOT) ∪ wiki page names (filename/title/aliases, Script/
// already excluded by walkContent). Used to (a) recognize tokens that are already
// correct and (b) find the nearest canonical for an OOV token.

import fs from "node:fs/promises"
import yaml from "js-yaml"
import { defsPath } from "./paths"
import { walkContent } from "./content"
import { foldForMatch } from "./normalize"
import { ensembleSim, phoneticCodes } from "./phonetics"

export interface LexEntry {
  canonical: string
  fold: string
  codes: [string, string]
}

export interface Hypothesis {
  canonical: string
  score: number
}

export interface Lexicon {
  /** True if a folded token exactly matches a whole canonical form. */
  has(fold: string): boolean
  /**
   * True if a folded token is a WORD within any canonical (single- or multi-word) —
   * e.g. "hildebrandt" is a token of "Hildebrandt Corporation", so it's correct
   * vocabulary even though it isn't a whole canonical on its own.
   */
  isToken(fold: string): boolean
  /** Top-k canonical hypotheses for an OOV fold, by ensembleSim, above `floor`. */
  nearest(fold: string, k?: number, floor?: number): Hypothesis[]
  entries: LexEntry[]
}

/** Read the canonical forms: defs.yaml keys ∪ wiki names. */
export async function loadCanonicalForms(): Promise<string[]> {
  const raw = await fs.readFile(defsPath, "utf8")
  const doc = (yaml.load(raw) ?? {}) as Record<string, unknown>
  const keys = Object.keys(doc)

  const docs = await walkContent()
  const names = docs.flatMap((d) => d.names)

  return [...new Set([...keys, ...names])]
}

/** Build a lexicon from an explicit list of canonical forms (hermetic; test-friendly). */
export function buildLexiconFrom(forms: string[]): Lexicon {
  const seen = new Set<string>()
  const entries: LexEntry[] = []
  for (const canonical of forms) {
    const fold = foldForMatch(canonical)
    if (!fold || seen.has(fold)) continue
    seen.add(fold)
    entries.push({ canonical, fold, codes: phoneticCodes(fold) })
  }
  const folds = new Set(entries.map((e) => e.fold))
  const tokens = new Set<string>()
  for (const e of entries) {
    for (const t of e.fold.split(" ")) if (t) tokens.add(t)
  }

  return {
    entries,
    has: (fold) => folds.has(fold),
    isToken: (fold) => tokens.has(fold),
    nearest(fold, k = 5, floor = 0.5) {
      return entries
        .map((e) => ({ canonical: e.canonical, score: ensembleSim(fold, e.fold) }))
        .filter((h) => h.score >= floor)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
    },
  }
}

/** Build the lexicon from the live defs.yaml + wiki. */
export async function buildLexicon(): Promise<Lexicon> {
  return buildLexiconFrom(await loadCanonicalForms())
}
