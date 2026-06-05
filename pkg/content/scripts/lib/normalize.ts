// Tokenization + diacritic folding for the typo surfacer. Folding is for
// MATCHING ONLY — canonical/original text always keeps its glyphs (Færrin, Anaïs).

// Ligatures and special letters NFKD does NOT decompose to ASCII (Færrin, Ætherion,
// Fūlwinter is fine via NFKD, but æ/ø/ß are atomic codepoints). Mapped after folding.
const LIGATURES: Record<string, string> = {
  æ: "ae",
  œ: "oe",
  ø: "o",
  ß: "ss",
  þ: "th",
  ð: "d",
  đ: "d",
  ł: "l",
}

/**
 * Fold a string to a diacritic-free, lowercased ASCII-ish form for fuzzy matching.
 * NFKD decomposes accented glyphs into base + combining mark (which we strip); a
 * ligature pass then expands the atomic codepoints NFKD leaves intact.
 */
export function foldForMatch(s: string): string {
  const stripped = s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  return stripped.replace(/[æœøßþðđł]/g, (c) => LIGATURES[c] ?? c)
}

/** A token (or n-gram) with its verbatim source span and matching fold. */
export interface Tok {
  /** Verbatim text as it appears in the source line (joined by single spaces for n-grams). */
  span: string
  /** Folded form used for matching. */
  fold: string
  /** Character offset of the span's first token within the source line. */
  start: number
}

// A word run: a letter/digit followed by letters/digits and internal ' ’ or - .
// Captures "P'ter", "Ki-Rin", "12", "barghest"; surrounding punctuation is excluded.
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/** Split a line into unigram tokens, preserving source offsets. */
export function tokenize(text: string): Tok[] {
  const toks: Tok[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const span = m[0]
    toks.push({ span, fold: foldForMatch(span), start: m.index ?? 0 })
  }
  return toks
}

/**
 * Expand a unigram stream into 1..maxN-grams. Multi-word spans are joined with a
 * single space (lossy vs. original spacing, but stable for matching multi-word
 * canonicals like "Dame Quay" / "Second Sun Diner").
 */
export function ngrams(toks: Tok[], maxN = 3): Tok[] {
  const out: Tok[] = []
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= toks.length; i++) {
      const slice = toks.slice(i, i + n)
      const span = slice.map((t) => t.span).join(" ")
      out.push({ span, fold: foldForMatch(span), start: slice[0].start })
    }
  }
  return out
}
