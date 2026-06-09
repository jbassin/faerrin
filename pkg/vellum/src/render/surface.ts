/**
 * Surface-syntax sugar. A pure, total `source → source` pass that rewrites terse
 * authoring sigils into vellum's canonical directive markdown *before* remark
 * parses it (see `parseMarkdown`). Design properties:
 *
 *  - **No-op on canonical syntax** — `:action[…]`, `:::statblock{…}`, headings,
 *    GFM tables, etc. are untouched, so existing documents and the golden images
 *    never move.
 *  - **Total** — it only ever rewrites recognized sigils; anything else passes
 *    through verbatim and renders as ordinary text. It cannot throw.
 *
 * The sigils:
 *
 *   `@2` `@reaction` `@free` `@r` `@f`   →  `:action[…]`  (known action tokens only)
 *   `||hidden text||`                    →  `:redact[…]`
 *   `#fire`                              →  `:trait[fire]`
 *
 * Scoping (so prose doesn't false-trigger): `@` must not follow a word char or
 * `@` (skips emails) and the token must be a known action; `#` must not follow a
 * word char or `#` and must be followed by a letter (skips `# Heading`,
 * `## Actions`, `C#`, `#123`). Known limitation: sigils inside code spans/fences
 * and inside `||…||` are still expanded — use the canonical `:directive[…]` form
 * if you need a literal `@2`/`#word` to survive.
 */

/** Action tokens — must stay aligned with `normalizeActionCost` in glyphs/actions. */
const ACTION = "reaction|react|free|single|double|triple|one|two|three|[0-3rf]";

const ACTION_RE = new RegExp(`(?<![\\w@])@(${ACTION})\\b`, "gi");
const REDACT_RE = /\|\|([^|\n]+)\|\|/g;
const TRAIT_RE = /(?<![\w#])#([A-Za-z][\w-]*)/g;

/** Rewrite vellum's authoring sigils into canonical directive markdown. */
export function desugar(source: string): string {
  return source
    .replace(REDACT_RE, ":redact[$1]")
    .replace(ACTION_RE, ":action[$1]")
    .replace(TRAIT_RE, ":trait[$1]");
}
