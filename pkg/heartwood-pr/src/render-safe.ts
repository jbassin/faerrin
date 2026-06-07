// GitHub-sanitizer-safe in-body prose representation (NLSpec 0002 C8/D-10; AC-23, R7).
//
// THE LOAD-BEARING FAILURE THIS AVOIDS: aether's renderer (`renderWikiMarkdown`) emits HTML whose
// meaning lives in `class`/`style` (callout <div>s, `::` directive blocks, <pre> flavor docs).
// GitHub's Markdown sanitizer STRIPS `class`/`style` (and unknown structure), so dropping aether's
// HTML into a PR body silently degrades to GitHub's own renderer — re-importing original failure #2
// (judging worldbuilding prose on the wrong surface). Therefore:
//
//   - the **aether-faithful** read is the per-page **deploy-preview** (AC-2/AC-18, the primary
//     fidelity surface) — NOT this module;
//   - the PR **body/comments** carry only this **sanitizer-safe** representation, whose meaning does
//     NOT depend on any construct GitHub strips.
//
// So this is deliberately NOT a faithful renderer. It is a lossy-but-safe projection of wiki
// markdown into the GFM subset GitHub renders intact: prose, bold/italic, lists, blockquotes,
// `<details>`. Wikilinks become their display text; Obsidian inline fields become bold labels;
// class/style/div (which GitHub would silently strip) are removed so nothing depends on them.
//
// NB: this guards the *representation*; a Phase-0 spike must still confirm empirically against the
// live GitHub sanitizer before the surface ships (R7/D-10). `hasStrippedConstructs` is the unit-test
// gate (AC-23: "a test must assert the chosen in-body representation round-trips … without losing
// structure") — it can't call GitHub offline, so it asserts the output contains nothing GitHub drops.

/** `[[Target]]` / `[[Target|alias]]` / `[[Path/To/Page#Section|alias]]` → its display text. */
function wikilinkDisplay(inner: string): string {
  const pipe = inner.indexOf('|');
  if (pipe !== -1) {
    const alias = inner.slice(pipe + 1).trim();
    if (alias) return alias;
  }
  const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const lastSeg = target.split('/').pop() ?? target;
  const noAnchor = lastSeg.replace(/#.*$/, '').trim();
  return noAnchor || target;
}

/**
 * Project wiki markdown into a GitHub-sanitizer-safe representation (AC-23). Lossy by design — the
 * faithful read is the deploy-preview. Transformations:
 *  1. `[[wikilinks]]` → display text (GitHub renders `[[Foo]]` literally; we show the human name).
 *  2. Obsidian inline fields `Key:: value` → `**Key:** value` (deity stat blocks become readable).
 *  3. strip `class=`/`style=` attributes — GitHub silently drops them, so nothing may depend on them.
 *  4. unwrap `<div>`/`<span>` — they carry no meaning once class/style are gone.
 */
export function toSanitizerSafe(markdown: string): string {
  let s = markdown;

  // 1. Wikilinks → display text.
  s = s.replace(/\[\[([^\]\n]+)\]\]/g, (_m, inner: string) => wikilinkDisplay(inner));

  // 2. Obsidian inline dataview fields `Key:: value` at line start → bold label (stat blocks).
  s = s.replace(
    /^(\s*)([A-Za-z][\w '\-]*?)::[ \t]*(.*)$/gm,
    (_m, pre: string, key: string, val: string) => `${pre}**${key.trim()}:** ${val}`.trimEnd(),
  );

  // 3. Remove elements GitHub strips WHOLESALE (content and all): script/style/iframe. Left in,
  //    their text would either vanish (so the body silently loses content) or, worse, the raw CSS/JS
  //    would surface as literal text. Drop paired blocks first, then any orphan tags.
  s = s.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/?(?:script|style|iframe)\b[^>]*>/gi, '');

  // 4. Drop class/style attributes (GitHub strips them).
  s = s.replace(/\s+(?:class|style)=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 5. Unwrap div/span shells (open + close tags), keeping their inner content.
  s = s.replace(/<\/?(?:div|span)\b[^>]*>/gi, '');

  return s.trim();
}

// Constructs GitHub's Markdown sanitizer strips or renders as dead literals — none may appear in a
// safe representation. (Not exhaustive of GitHub's allowlist; these are the ones aether produces.)
const STRIPPED_CONSTRUCTS: { name: string; re: RegExp }[] = [
  { name: 'class attribute', re: /\sclass=/i },
  { name: 'style attribute', re: /\sstyle=/i },
  { name: 'div element', re: /<div\b/i },
  { name: 'span element', re: /<span\b/i },
  { name: 'script element', re: /<script\b/i },
  { name: 'style element', re: /<style\b/i },
  { name: 'iframe element', re: /<iframe\b/i },
  { name: 'inline event handler', re: /\son[a-z]+=/i },
  { name: 'unrendered wikilink', re: /\[\[/ },
];

/**
 * True if `s` still contains a construct GitHub would strip or render as a dead literal (AC-23 gate).
 * The PR-body generator and its tests assert this is `false` for everything they put on GitHub.
 */
export function hasStrippedConstructs(s: string): boolean {
  return STRIPPED_CONSTRUCTS.some((c) => c.re.test(s));
}

/** The names of any stripped constructs found (for assertions/diagnostics). */
export function strippedConstructsIn(s: string): string[] {
  return STRIPPED_CONSTRUCTS.filter((c) => c.re.test(s)).map((c) => c.name);
}
