import type { ContentDoc } from "./types"

/** Escape regex metacharacters so page titles/aliases match literally. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Build an auto-wikilink replacer from all content docs. Plain-text mentions of
 * a page's title/aliases are rewritten to Obsidian-style links.
 *
 * Correctness properties (vs. the original per-doc, first-match-only version):
 *  - names are regex-escaped, so titles with metacharacters can't break matching;
 *  - a SINGLE combined pass is used, so already-inserted link syntax is never
 *    re-scanned (avoids nested links like `[[Ghosts of [[Raelion]]|...]]`);
 *  - alternatives are sorted longest-first, so multi-word titles win over a
 *    shorter title that is a substring of them;
 *  - matching is global + case-insensitive, so every mention is linked while the
 *    matched text's original casing is preserved in the link alias.
 */
export function buildLinker(docs: ContentDoc[]): (s: string) => string {
  const entries: { name: string; target: string }[] = []
  for (const { file, title, names } of docs) {
    const target = file.endsWith("index.md") ? file.replace(/\.md$/, "") : title
    for (const name of names) {
      entries.push({ name, target })
    }
  }

  if (entries.length === 0) return (s) => s

  // Longest names first: in a regex alternation the first matching branch wins,
  // so this makes "Ghosts of Raelion" win over "Raelion" at a shared position.
  entries.sort((a, b) => b.name.length - a.name.length)

  // Resolve a matched span back to its link target (case-insensitive). First
  // (i.e. longest) registration wins on collision.
  const targetByName = new Map<string, string>()
  for (const { name, target } of entries) {
    const key = name.toLowerCase()
    if (!targetByName.has(key)) targetByName.set(key, target)
  }

  const alternation = entries.map((e) => escapeRegex(e.name)).join("|")
  const regex = new RegExp(`\\b(${alternation})\\b`, "gi")

  return (s: string): string =>
    s.replace(regex, (match) => {
      const target = targetByName.get(match.toLowerCase())
      return target === undefined ? match : `[[${target}|${match}]]`
    })
}
