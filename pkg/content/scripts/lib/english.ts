// Out-of-vocabulary gate: a token is a candidate only if it's neither in the
// canonical lexicon (checked elsewhere) nor an ordinary English word. Uses a
// ~275k-word set; inflection/possessive forms are stripped before the lookup.

import words from "an-array-of-english-words"

const ENGLISH = new Set(words)

const PURE_NUMERIC = /^[\d.,:]+$/

/** True if the folded token is a known English word. */
export function isEnglish(fold: string): boolean {
  return ENGLISH.has(fold)
}

/**
 * True if the folded token is "unusual" — not numeric, not English (after
 * stripping a trailing possessive or plural). Lexicon membership is checked by
 * the caller; this is purely the English/number gate.
 */
export function isOov(fold: string): boolean {
  if (!fold) return false
  if (PURE_NUMERIC.test(fold)) return false
  if (ENGLISH.has(fold)) return false
  if (fold.endsWith("'s") && ENGLISH.has(fold.slice(0, -2))) return false
  if (fold.endsWith("’s") && ENGLISH.has(fold.slice(0, -2))) return false
  if (fold.endsWith("s") && fold.length > 3 && ENGLISH.has(fold.slice(0, -1))) return false
  return true
}
