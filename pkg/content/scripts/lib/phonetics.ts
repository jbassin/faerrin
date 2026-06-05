// Fuzzy-similarity primitives: a weighted ensemble of edit distance, Jaro-Winkler,
// phonetic-code distance, and Dice overlap. No single metric handles both
// orthographic chaos ("sbrtlby") and sounds-right-spelled-wrong ("twelwyn"); the
// blend does. All inputs are expected pre-folded (see normalize.foldForMatch).

import { doubleMetaphone } from "double-metaphone"
import jaroWinkler from "jaro-winkler"
import damerau from "damerau-levenshtein"
import { diceCoefficient } from "dice-coefficient"

/** Double Metaphone [primary, secondary] codes for a folded string. */
export function phoneticCodes(fold: string): [string, string] {
  const [a, b] = doubleMetaphone(fold)
  return [a, b]
}

/** Damerau (OSA) similarity in [0,1]; transposition-aware. */
export function editSim(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  return damerau(a, b).similarity
}

/** Jaro-Winkler similarity; inputs already folded, so compare case-sensitively. */
export function jaroSim(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  return jaroWinkler(a, b, { caseSensitive: true })
}

/** Sørensen-Dice bigram overlap in [0,1]. */
export function diceSim(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  return diceCoefficient(a, b)
}

/**
 * Similarity of two strings by the edit distance between their phonetic codes —
 * far more robust to fantasy orthography than bucketing on exact code equality.
 * Best score across the primary/secondary code pairs.
 */
export function phoneticSim(aFold: string, bFold: string): number {
  const a = phoneticCodes(aFold)
  const b = phoneticCodes(bFold)
  let best = 0
  for (const x of a) {
    for (const y of b) {
      if (!x && !y) continue
      best = Math.max(best, editSim(x, y))
    }
  }
  return best
}

/** Ensemble weights (sum to 1). Phonetic + prefix dominate for proper nouns. */
export const WEIGHTS = { edit: 0.3, jaro: 0.3, phonetic: 0.3, dice: 0.1 } as const

/** Weighted blend of all four signals, in [0,1]. */
export function ensembleSim(aFold: string, bFold: string): number {
  if (aFold === bFold) return 1
  return (
    WEIGHTS.edit * editSim(aFold, bFold) +
    WEIGHTS.jaro * jaroSim(aFold, bFold) +
    WEIGHTS.phonetic * phoneticSim(aFold, bFold) +
    WEIGHTS.dice * diceSim(aFold, bFold)
  )
}
