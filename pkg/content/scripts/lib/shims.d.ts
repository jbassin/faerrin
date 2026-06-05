// Ambient declarations for fuzzy/phonetic libs that ship no TypeScript types.
// The wooorm packages (double-metaphone, dice-coefficient) and mnemonist ship
// their own .d.ts, so they are intentionally absent here.

declare module "jaro-winkler" {
  /** Jaro-Winkler similarity in [0,1]. Folded inputs → pass caseSensitive:true. */
  export default function jaroWinkler(
    a: string,
    b: string,
    options?: { caseSensitive?: boolean },
  ): number
}

declare module "damerau-levenshtein" {
  interface DamerauResult {
    /** raw edit operations (incl. adjacent transpositions) */
    steps: number
    /** steps / maxLen */
    relative: number
    /** 1 - relative, in [0,1] */
    similarity: number
  }
  export default function damerauLevenshtein(a: string, b: string): DamerauResult
}

declare module "an-array-of-english-words" {
  /** ~275k lowercased English words. */
  const words: string[]
  export default words
}
