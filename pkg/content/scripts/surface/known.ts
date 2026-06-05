// Mode 1 — known-entity correction. For each line, flag OOV unigrams whose nearest
// canonical clears the floor, and multi-word n-grams that closely match a multi-word
// canonical (e.g. "Dame Key" -> "Dame Quay"). Each candidate carries up to 5
// canonical hypotheses for the reviewer (or the Phase-2 LLM judge) to choose from.

import { surface } from "../config"
import { isOov } from "../lib/english"
import { tokenize, type Tok } from "../lib/normalize"
import { ensembleSim } from "../lib/phonetics"
import type { Hypothesis, Lexicon } from "../lib/lexicon"
import type { Transcript } from "../lib/types"

export interface KnownCandidate {
  /** 0-based line index within the session (stable ref). */
  lineRef: number
  /** Verbatim mistranscribed span. */
  span: string
  speaker: string
  lineText: string
  /** Canonical hypotheses, best first. */
  hypotheses: Hypothesis[]
}

/** Capitalized first letter: the signal that a token is a proper-noun garble. */
function isNamelike(span: string): boolean {
  return /^\p{Lu}/u.test(span)
}

/** Folded base of a possessive ("anouk's" -> "anouk"), or null if not possessive. */
function possessiveBase(fold: string): string | null {
  return /['’]s$/.test(fold) ? fold.slice(0, -2) : null
}

// Function words that bound multi-word canonicals ("The Master of Ceremonies",
// "the Scale") plus determiners/quantifiers that can front a name in running speech
// ("other Harlequins", "those Wretches"). A span differing from a canonical only by
// these edge words is the same name with a swapped/added article or determiner — not
// a mistranscription of the name itself.
const EDGE_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "to", "in", "on", "at", "for", "with", "by",
  "other", "another", "these", "those", "this", "that", "some", "any", "such",
  "many", "few", "several", "more", "most", "every", "each", "both", "all",
])

function stripEdgeStopwords(fold: string): string {
  const w = fold.split(" ")
  while (w.length > 0 && EDGE_STOPWORDS.has(w[0])) w.shift()
  while (w.length > 0 && EDGE_STOPWORDS.has(w[w.length - 1])) w.pop()
  return w.join(" ")
}

/** True if two folds are equal once leading/trailing function words are removed. */
function differsOnlyByEdgeWords(a: string, b: string): boolean {
  const core = stripEdgeStopwords(a)
  return core.length > 0 && core === stripEdgeStopwords(b)
}

/**
 * True if a *proper* contiguous sub-span of the slice is itself an exact canonical.
 * Such an n-gram is just a correct canonical padded with adjacent (correct) words
 * — e.g. "is Ralph Bishop" / "at Iconoclasm" — so it's not an error.
 */
function paddedCanonical(slice: Tok[], lex: Lexicon): boolean {
  for (let a = 0; a < slice.length; a++) {
    for (let b = a + 1; b <= slice.length; b++) {
      if (b - a === slice.length) continue // the whole span is handled separately
      const f = slice.slice(a, b).map((t) => t.fold).join(" ")
      if (lex.has(f)) return true
    }
  }
  return false
}

export function findKnown(t: Transcript, lex: Lexicon): KnownCandidate[] {
  const multiword = lex.entries.filter((e) => e.fold.includes(" "))

  // Keyed by (lineRef, top canonical): collapses overlapping n-gram windows and
  // unigram/multiword that point at the same canonical on one line, keeping the
  // best-scoring span.
  const best = new Map<string, KnownCandidate>()
  const push = (c: KnownCandidate): void => {
    const key = `${c.lineRef} ${c.hypotheses[0].canonical}`
    const prior = best.get(key)
    if (!prior || c.hypotheses[0].score > prior.hypotheses[0].score) best.set(key, c)
  }

  t.script.forEach((line, lineRef) => {
    const toks = tokenize(line.text)

    // Unigrams: OOV, not already canonical (nor a possessive of one), capitalized
    // mid-line (or a very strong match), near a known canonical.
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i]
      if (tok.fold.length < surface.minTokenLen) continue
      if (!isOov(tok.fold) || lex.has(tok.fold) || lex.isToken(tok.fold)) continue
      const pb = possessiveBase(tok.fold)
      if (pb && lex.has(pb)) continue // correct possessive of a canonical, not an error
      const hyps = lex.nearest(tok.fold, 5, surface.knownFloorUnigram)
      if (hyps.length === 0) continue
      const namelike = i > 0 && isNamelike(tok.span)
      if (!namelike && hyps[0].score < surface.strongScore) continue
      push({ lineRef, span: tok.span, speaker: line.user.name, lineText: line.text, hypotheses: hyps })
    }

    // Multi-word n-grams matched only against multi-word canonicals, requiring a
    // capitalized non-line-initial token (kills "the bat" / "meeting with" noise)
    // and skipping spans that merely pad an already-correct canonical.
    for (let n = 2; n <= surface.maxNgram; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const slice = toks.slice(i, i + n)
        const hasName = slice.some((tk, k) => i + k > 0 && isNamelike(tk.span))
        if (!hasName) continue
        const fold = slice.map((x) => x.fold).join(" ")
        if (lex.has(fold)) continue // span already exactly a canonical
        if (paddedCanonical(slice, lex)) continue // canonical content already correct
        const span = slice.map((x) => x.span).join(" ")
        let top: Hypothesis | null = null
        for (const e of multiword) {
          if (differsOnlyByEdgeWords(fold, e.fold)) continue // same name minus an article
          const score = ensembleSim(fold, e.fold)
          if (score >= surface.knownFloorMulti && (!top || score > top.score)) {
            top = { canonical: e.canonical, score }
          }
        }
        if (top) push({ lineRef, span, speaker: line.user.name, lineText: line.text, hypotheses: [top] })
      }
    }
  })

  return [...best.values()].sort((a, b) => a.lineRef - b.lineRef)
}
