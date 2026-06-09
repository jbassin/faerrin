# Vellum Structured Syntax (VSS) — NLSpec

**Status:** Revised (post adversarial completeness challenge) — implementation-ready (~90/100)
**Package:** `@faerrin/vellum` (`pkg/vellum`)
**Origin:** `/octo:brainstorm` → "cleaner block syntax" → brace-delimited surface.
**Relationship to prior work:** sibling to the regex sigil desugar seam shipped in
`src/render/surface.ts` (`@action`/`#trait`/`||redact||`). This adds a *structural*
surface; that one stays for *inline* content.

---

## 1. Summary

Add **Vellum Structured Syntax (VSS)** — a brace/bracket-delimited surface for the
*structure* of a document (blocks + columns) — that **compiles to the existing
canonical `:::`-directive markdown** before anything else runs. Markdown + GFM +
the inline sigils remain the language of **content** inside `{ … }` bodies.

> **Design axiom: braces for STRUCTURE, markdown for CONTENT.**
> VSS is a *structural compiler*, not a replacement parser. It never reimplements
> markdown; it emits canonical directive markdown and hands bodies to remark
> verbatim. The model (`VellumDocument`), renderer, and golden images are untouched.

Worked example (input → compiled canonical):

```
@columns [
  {
    ## Tier I
    @item "Reinforced Bulkheads"
    | price: 30 Energy
    | level: 1
    {
      The Fortitude DC of the base camp increases by **+2**.
    }
  }
  {
    ## Tier 2
    @item "Alarm Wards"
    | price: 35 Energy
    {
      Stealth checks to infiltrate suffer a **-2** penalty.
    }
  }
]
```

compiles to (then flows through the *existing* sigil desugar + remark pipeline):

```
:::::columns
::::column
## Tier I

:::item[Reinforced Bulkheads]{price="30 Energy" level="1"}
The Fortitude DC of the base camp increases by **+2**.
:::
::::
::::column
## Tier 2

:::item[Alarm Wards]{price="35 Energy"}
Stealth checks to infiltrate suffer a **-2** penalty.
:::
::::
:::::
```

Note the **auto-computed colon depth** (`:::::columns` > `::::column` > `:::item`):
the author never counts colons — VSS computes fence depth from brace nesting,
eliminating the documented colon-counting footgun.

**VSS emits the explicit `:::column` form, not `---` dividers** (decision in §5).
This was verified to round-trip: `parseDocument` of the block above yields
`columns(2 cols: [prose, item{price="30 Energy" level="1"}], [prose, item{price="35 Energy"}])`.
The explicit path is deterministic in `parseColumns` (filters `:::column` children,
`parse.ts:151`); the `---` path is fragile (a `---` adjacent to a heading/close can
be read as a setext underline, not a `thematicBreak`).

---

## 2. Actors & surfaces

| Actor | Cares about |
|-------|-------------|
| Author (GM) | Typing/reading cards fast; structure that doesn't fight them |
| Renderer library (`src/render/`) | Receives one `VellumDocument`; unaware VSS exists |
| Render service (Playwright) | Same — parses through `parseMarkdown`, screenshots |
| Editor (`src/app/`) | Highlighting, bracket matching, folding, snippets for VSS |

**Three coexisting surfaces, one model:**
1. **Canonical** `:::kind[Title]{attrs}` … `:::` (AD-6, degrades gracefully).
2. **Inline sigils** `@2` / `#fire` / `||x||` (existing `desugar`).
3. **VSS** `@kind "Title" |attrs { body }`, `@columns [ {…} {…} ]` (this spec).

All three compile to the same `VellumDocument`. VSS and sigils are opt-in sugar
over (1).

---

## 3. The AD-6 tension (decision: AD-6a)

**AD-6** mandates "valid-ish CommonMark, degrades gracefully (aether/Obsidian render
it as plain)." **VSS source does *not* degrade** — `@columns [ { … } ]` is garbage in
a vanilla markdown viewer.

**Decision AD-6a:** VSS is an **opt-in structural surface**; AD-6's
graceful-degradation guarantee continues to hold for the **canonical + sigil**
syntax, which remains the portable/default form. Authoring in VSS is an explicit
trade of portability for structure, scoped to vellum-rendered contexts (editor
preview, render service, share links). This is acceptable because:
- VSS **compiles to** the AD-6-compliant canonical form; a future formatter
  (deferred) can serialize VSS → canonical for export/portability.
- The author opts in per document; nothing forces VSS on existing content.

This is the single architectural cost of the feature and is accepted knowingly.

**Share-link / docStore implications (honest scope, per challenge S2):** share links
(R-20) LZ-encode the **active document source** — so a VSS-authored doc's share link
embeds non-degrading `@columns […]` source; it is **vellum-only** until the Phase 3
formatter exists. Two firm rules follow: (1) the future `pkg/content` write-back must
serialize **canonical**, never raw VSS, until the formatter ships; (2) `deriveTitle`
in `docStore` operates on raw source and must learn VSS (§9, S1) or VSS docs all title
as "Untitled". We accept vellum-only share links for VSS docs in v1; we do **not**
silently regress portability of canonical docs.

---

## 4. Grammar (EBNF-ish)

```ebnf
document   ::= content
content    ::= ( construct | markdown-run )*      ; interleaved, in order
construct  ::= block | columns
block      ::= LINESTART "@" kind SP+ title attr* SP* group
columns    ::= LINESTART "@columns" SP* "[" group+ "]"
group      ::= "{" content "}"                    ; a column OR a body — same thing
kind       ::= "statblock" | "hazard" | "item" | "spell" | "handout" | "edict"
title      ::= '"' ( char | '\"' )* '"'           ; \" escapes a quote
attr       ::= NL SP* "|" SP* key SP* ":" value   ; one per line, between title and group
key        ::= [A-Za-z][A-Za-z0-9_-]*
value      ::= <rest of line, trimmed>            ; multi-word; split on FIRST ":"
markdown-run ::= <CommonMark + GFM + inline sigils; nested constructs allowed>

; LINESTART = start of a line modulo leading whitespace. The @kind/@columns
; openers MUST be at line start; `said @item "junk"` mid-prose is literal text.
```

Notes:
- `group` is recursive: a column body and a block body are the same construct (a
  `{}` content group). A group may contain markdown **and** nested blocks/columns.
- `attr` lines may appear only **between** the title and the body `{`. The body `{`
  unambiguously ends the attribute region — no `--`/blank-line separator needed.
  A `|` line **after** the body opens is body text, not an attribute.
- `key: value` splits on the **first** `:` (so `level: Creature 2` and a value with a
  colon both work). Value is the rest of the line, trimmed; no comments/continuations.
- `title` is required and quoted (handles spaces; may contain inline sigils, e.g.
  `@item "Look Out Behind You @reaction"`).
- Whitespace/newlines between tokens are insignificant except inside `value` and
  `markdown-run`.

### Recognition guard (prevents prose false-positives)
A `@kind` is a VSS block **only** when, **at line start** (modulo indentation), it
matches `@<kind> SP+ "…"` (a kind in the closed set `DOCUMENT_KINDS` + a quoted
title). `@columns` is VSS only at line start followed by `[`. Consequences:
- Bare `@item` in prose, or `said @item "junk"` mid-line, is literal text (not line
  start). `@everyone`/email at line start isn't a kind → literal.
- The inline `@action` sigil only fires on known action tokens; kinds (`item`,
  `columns`, …) are not action tokens, so the two `@`-uses never collide.

---

## 5. Tokenizer / brace-matcher (the hard part)

VSS does **not** tokenize markdown. It scans for structural tokens (`@kind`,
`@columns`, `[`, `]`, `{`, `}`, `|key:`) and treats everything inside a body group
as opaque text **except** to find the matching `}`.

### Brace matching rule (find the *matching* `}`, not the first)
Scanning a body from its opening `{`, maintain `depth = 1`. The scanner tracks
markdown lexical state so it skips braces that aren't structural. Per character/line:
1. **Escapes:** `\{` and `\}` are literal — consumed, not counted. On emit they're
   kept as `\{`/`\}` in the body (NOT unescaped) so a bare `{` can never be read by
   remark-directive as an attribute block on an adjacent token.
2. **Inline code spans:** an opening backtick run of length *n* opens a span; braces
   inside are ignored until a closing backtick run of **exactly length *n*** (the
   CommonMark rule). Mismatched-length runs don't close.
3. **Fenced code blocks:** a line whose first non-space content is a run of ≥3
   backticks **or** ≥3 tildes opens a fence; it closes only on a later line whose
   fence is the **same character** and **≥ the opening length** (CommonMark). Braces
   inside are ignored. (So a `~~~` body may contain ` ``` ` without closing.)
4. **Indented code (4-space) is NOT tracked** — declared **unsupported inside VSS
   bodies**: to include brace-bearing literal code in a body, use a *fenced* block,
   not 4-space indentation. Documented limitation (else a `}` in indented code would
   mis-close). The matcher treats indented lines normally.
5. **Bare `:::` fence inside a body:** if a line in the body opens a canonical `:::`
   directive, emit `:vsserr[nested ::: not allowed in a VSS body — use VSS braces]`
   for that construct (mixing surfaces would break the outer>inner colon invariant).
6. Otherwise: unescaped `{` → `depth++`; unescaped `}` → `depth--`. Body ends when
   `depth == 0`; that `}` is the matching close. EOF first → **unterminated** (§6 E3).

The scanner is small (code spans/fences + escapes + a `:::` check) and total. Nested
VSS constructs are found by recursing the same scan on the extracted body.

### Colon-depth computation
Assign each emitted directive a fence colon count **bottom-up**:
```
colons(leafDirective)      = 3                      ; markdown-only body
colons(node)               = 1 + max(2, maxChildDirectiveColons)
```
i.e. **one more than the deepest directive nested inside it** (floor 3). This is the
only colon rule — there is no top-down decrement. With the explicit `:::column`
form, a two-column-of-items layout is therefore `:::::columns` (5) > `::::column`
(4) > `:::item` (3), confirmed by the §1 round-trip. remark-directive requires
outer > inner; this guarantees it at every level. A hard nesting cap (§6 E13) bounds
depth so colon counts and recursion both stay finite.

---

## 6. Totality & error model (R-4: never throw; malformed → ErrorChip)

VSS compilation is **total**. On any structural error it emits a sentinel error
directive `:vsserr[reason]` into the canonical output.

**`:vsserr` requires an explicit renderer branch** (not the default `?name` chip):
`renderDirective` must add `if (name === "vsserr") return <ErrorChip
message={collectText(children)} />;` — otherwise it renders a content-free `?vsserr`.
**This branch ships in Phase 1**, alongside the compiler, so errors are never blank.

**`reason` is sanitized** before being placed in `[reason]`: strip/escape `]` and
`[`, collapse newlines to spaces, and truncate to ~80 chars. (An un-sanitized reason
echoing author input — e.g. a title containing `]` — would itself produce malformed
directive markdown, defeating R-4.)

Enumerated cases:

| # | Malformed input | Behavior |
|---|-----------------|----------|
| E1 | `@item` with no quoted title | `:vsserr[@item: expected "title"]`; skip to next line |
| E2 | `@item "X"` with no `{ body }` (next construct / EOF) | `:vsserr[@item "X": missing { body }]` |
| E3 | `@item "X" {` … EOF (unterminated body) | `:vsserr[@item "X": unterminated body]`; body = text up to EOF, rendered |
| E4 | `@columns` not followed by `[` | `:vsserr[@columns: expected [ … ]]` |
| E5 | `@columns [` … EOF (unterminated list) | `:vsserr[@columns: unterminated [ … ]]`; compile groups found so far |
| E6 | Content inside `@columns [ … ]` that is not a `{group}` | ignored (whitespace) or, if non-trivial, `:vsserr[@columns: expected { column }]` |
| E7 | Unknown `@kind` (`@monster "X" {…}`) | **not** VSS — passes through as literal text (mirrors `:::monster` → prose) |
| E8 | Stray `}` / `]` / `{` with no opener (content position) | literal text (degrade; may be prose) |
| E9 | `@kind "X"` with attrs but body never opens before next `@`/EOF | E2 |
| E10 | Two quoted strings after `@kind` (`@item "A" "B" {`) | second string is body-text inside `{}` if it follows the body open; otherwise `:vsserr[@item: unexpected "B"]` |
| E11 | `\|` attribute line appearing after the body `{` opened | treated as ordinary body text (not an attr) |
| E12 | Attribute value containing `"` or `}` (would break `{key="…"}`) | `:vsserr[@kind: attribute 'key' has an unsupported character]`; other attrs still emitted |
| E13 | Nesting deeper than the cap (default 16) | `:vsserr[too deeply nested]`; stop recursing (bounds recursion + colon counts → no stack overflow / no runaway fences) |
| E14 | Bare `:::` canonical fence inside a VSS body | `:vsserr[nested ::: not allowed in a VSS body]` (per §5 rule 5) |

No input throws and recursion is depth-capped (E13); the worst case is a visible chip
plus best-effort rendering of recoverable content. Drives an extended NFR-9 fuzz
corpus (unbalanced `{`/`[`, missing titles, truncated input, deep nesting).

---

## 7. Pipeline integration

New pure module `src/render/vss.ts` exporting `compileVss(source: string): string`.
Wire it as the **first** pass in `parseMarkdown` (before the regex `desugar`):

```ts
// parse.ts
export function parseMarkdown(source: string): Root {
  return processor.parse(desugar(compileVss(source))) as Root;
}
```

**Pass order & why:**
1. `compileVss` consumes `@kind "…" { … }` / `@columns [ … ]` → emits canonical
   `:::` markdown; bodies emitted verbatim (still containing `@2`/`#fire`/`||x||`).
2. `desugar` (existing) rewrites the inline sigils in those bodies.
3. remark (`remark-parse → remark-gfm → remark-directive`) parses the result.

Because `compileVss` runs first and removes the `@kind` block openers, the only `@`
left for the sigil pass are inline action tokens — no collision.

Both `compileVss` and `desugar` are **no-ops** on input that doesn't use their
syntax, so canonical docs and the golden fixtures are byte-identical through the
pipeline. `parseDocument` is unchanged (it calls `parseMarkdown`); the render
service and editor preview inherit VSS automatically.

---

## 8. Compile-to-canonical algorithm

```
compileVss(source):
  nodes = parseContent(source, depthHint)        # recursive-descent over structural tokens
  return serialize(nodes)                          # emit canonical markdown

parseContent(text):                                # returns ordered list of {markdown | block | columns}
  walk text; collect markdown-runs verbatim;
  on a recognized @kind/@columns construct, parse it (matching braces per §5),
  recursing parseContent on each group body.

FENCE(node) = ":".repeat(colons(node))            ; colons per §5, bottom-up

serialize(node):
  markdown-run -> emit verbatim
  block        -> FENCE + kind + "[" + escapeLabel(title) + "]" + attrBlock(node) + NL
                  + serializeChildren(node) + NL + FENCE
  columns      -> FENCE + "columns" + NL
                  + join( ("::".. col-fence) + "column" + NL + serializeChildren(col) + NL + colfence
                          for col in groups, separator = NL )
                  + NL + FENCE
                  ; each column is emitted as an EXPLICIT :::column container at
                  ; colons(columns)-1 (proven robust path; NOT --- dividers)
  error        -> emit ":vsserr[" + sanitize(reason) + "]"

# Blank-line discipline (required for round-trip): emit a blank line BEFORE every
# directive opener that follows a markdown-run or a sibling fence, and AFTER every
# closing fence. (Heading-adjacent-to-fence was verified to parse even without a
# blank line, but VSS emits them defensively.)
# escapeLabel(title): backslash-escape ']' and '[' so a title with brackets can't
#   close the [label] early. Inline sigils in the title pass through to be desugared
#   into :action etc. inside the label (NB: per parse.ts inlineText they then drop
#   OUT of the plain-text label/deriveTitle — the glyph shows, the title text omits
#   it; intended, documented in §9).
# attrBlock: "" if no attrs, else "{" + join(key=\"value\") + "}"; a value with '"'
#   or '}' is rejected per E12; empty values dropped; duplicate keys last-wins;
#   `traits: a, b` -> traits="a,b" (trim each).
```

Keys pass through verbatim; `normalizeAttributes` ignores unknown keys, so VSS
imposes no key whitelist. The quoted `title` becomes the `[label]`; a `name`
attribute, if also given, is the canonical fallback only — **the title wins** (and
since VSS titles are mandatory, an extra `name:` is redundant; documented).

---

## 9. Coexistence & migration

- **Additive.** Canonical `:::` and inline sigils keep working unchanged. A doc may
  even mix VSS and canonical (though mixing `:::` *inside* a VSS body is undefined —
  use VSS braces for nesting; documented).
- **No forced migration.** Existing documents and share links are untouched.
- **Goldens byte-stable.** Asserted by a test: `compileVss(fixture.source) ===
  fixture.source` for every fixture (none use VSS), so no golden regen.
- **`docStore.deriveTitle` must learn VSS (S1).** It scans raw source with
  `/:{3,}[a-z][\w-]*\[(.+)\]…/` — which never matches `@item "…"`, so VSS docs would
  all title "Untitled". Add a VSS branch to `deriveTitle`: also match
  `/^\s*@[a-z]+\s+"([^"]+)"/m` and take whichever (canonical or VSS) appears first.
  Lands in Phase 1 (it's source-level, like the compiler).
- **Future (deferred):** a canonical→VSS / VSS→canonical formatter for portable
  export (restores AD-6 portability on demand); until then VSS share links are
  vellum-only and `pkg/content` write-back uses canonical (§3).

---

## 10. Editor support (CodeMirror, `src/app/`)

**v1 (this spec):**
- `vellumHighlight.ts`: regex decorations for `@kind`/`@columns` openers,
  `| key:` gutter lines, and the quoted title; sigils inside bodies keep their
  existing highlighting.
- Enable `@codemirror/language` `bracketMatching()` and `foldGutter()` so `{}`/`[]`
  match-highlight and fold (declared deps already present via lang/commands).
- `slashComplete.ts`: the block/column snippets **switch to emitting VSS** (one
  recommended structural surface), replacing the current canonical `:::`/`::::columns`
  inserts — e.g. `/item` → `@item "…"\n| level: \n{\n\n}\n`, `/columns` →
  `@columns [\n  {\n  }\n  {\n  }\n]\n`. Avoids two competing `/columns` completions
  (the existing canonical `::::columns` snippet, `slashComplete.ts:56`). Canonical
  syntax still parses; it's just no longer the snippet default.

**Future (deferred):** a Lezer grammar for true syntax-aware highlighting,
folding, and autocomplete (replaces the regex decorations; larger effort).

---

## 11. Test strategy (extends NFR-9)

**Unit — `vss.test.ts`:**
- The §1 worked example compiles to the exact canonical string shown (explicit
  `:::column`, `:::::`/`::::`/`:::`).
- **Round-trip (not just string equality):** `parseDocument(compileVss(vssExample))`
  deep-equals the intended `VellumDocument` (the structural assertion that catches
  blank-line/fence-adjacency bugs the string test can't).
- **Idempotence:** `compileVss(compileVss(x)) === compileVss(x)`.
- Auto colon-depth: nested `@columns` inside a column → `:::::::`/`::::::`/`:::::`/… `.
- Brace matching: literal braces in prose (`press the } key`), inline code spans
  (`` `{` ``, mismatched backtick-run lengths), tilde fences containing ` ``` `, and
  escapes (`\{`, `\}`) don't mis-close the body; 4-space indented code with braces is
  the documented unsupported case (test asserts the limitation, not silent success).
- Title/attr escaping: a title with `]`; an attr value with `"`/`}` → E12 chip;
  empty value dropped; duplicate key last-wins; `traits: a, b` → `traits="a,b"`.
- Each error case E1–E14 → expected `:vsserr[…]` / literal passthrough; never throws;
  reason sanitization (a title with `]` in an error doesn't break the chip).
- **No-op guarantee:** `compileVss(f.source) === f.source` for every visual fixture.

**Render — `mdastToReact.test.tsx` / parse:**
- VSS example via `parseDocument` → `DocumentView` HTML contains the two-column
  layout and both item cards; sigils inside VSS bodies still render glyphs.
- `:vsserr[reason]` renders an `ErrorChip` showing the reason (requires the §6
  renderer branch; assert the message text appears).

**docStore:** `deriveTitle` of a VSS source returns the quoted title (S1), not
"Untitled".

**Fuzz:** a malformed-VSS corpus (unbalanced braces/brackets, missing titles,
truncated input, > cap nesting) asserts `compileVss` never throws and `parseDocument`
stays total.

**No new goldens required** for the compiler (output is canonical, already covered).
Optionally add one VSS-authored fixture later to lock editor-facing behavior.

---

## 12. Phased rollout

**Phase 1 — Compiler (core).** `src/render/vss.ts` (`compileVss` + brace-matcher +
error model), wired into `parseMarkdown` before `desugar`. **Includes** the `vsserr`
branch in `mdastToReact.renderDirective` (§6) and the VSS branch in
`docStore.deriveTitle` (§9, S1) — both are needed for Phase 1 to be coherent
(errors must render; titles must resolve). Unit + round-trip + idempotence + fuzz
tests + no-op-on-fixtures. Export `compileVss` from `index.ts`. *Gate:* typecheck,
full test suite green, `compileVss` no-op on all fixtures (goldens unmoved),
round-trip test passes.

**Phase 2 — Editor + docs.** `vellumHighlight.ts` decorations, bracket
matching/folding, `slashComplete.ts` VSS snippets; `MARKDOWN.md` gains a "Structured
syntax (VSS)" section documenting the grammar, the AD-6a trade-off, brace/escape
rules, and the error chips. *Gate:* typecheck, build, manual editor check.

**Phase 3 — Deferred.** Lezer grammar; canonical↔VSS formatter; consider
deprecating `:::` if VSS proves preferable.

---

## 13. What we're NOT doing

- Not replacing remark / reimplementing markdown — bodies are still CommonMark+GFM.
- Not changing the `VellumDocument` model, renderer, components, or goldens.
- Not removing canonical `:::` or the inline sigils.
- Not building a Lezer grammar or a formatter in v1 (Phase 3).
- Not supporting `:::` directives *inside* VSS bodies (use VSS braces to nest).

---

## 14. Open questions

None. The adversarial completeness challenge (code-reviewer persona) surfaced six
blockers and several should-fixes; all are resolved in this revision:
- **Round-trip (B1):** switched to explicit `:::column` emission + pinned blank-line
  discipline; **empirically verified** the §1 example parses to the intended
  `VellumDocument`; round-trip test mandated.
- **Colon math (B2):** simplified to `1 + max(2, deepestChild)`, bottom-up only;
  5/4/3 confirmed.
- **`vsserr` rendering (B3) + reason/title escaping (B4, B5):** explicit renderer
  branch in Phase 1; sanitize reasons; escape labels.
- **Brace-matcher lexical states (B6):** code-span run-length, tilde fences,
  indented-code declared unsupported, literal braces kept escaped, bare-`:::`
  rejected.
- **docStore/share links (S1, S2):** `deriveTitle` VSS branch; portability regression
  stated honestly (vellum-only share links; canonical for `pkg/content`).
- **Attributes (S3), recognition guard (S4), error gaps (S5), `---` vs `:::column`
  (S6), perf/idempotence (N1, N2), snippet collision (N3):** all addressed above.

## 15. References

- `pkg/vellum/CLAUDE.md` — architecture (AD-4/AD-6, R-4, R-9), conventions.
- `thoughts/vellum/specs/2026-06-09-vellum-diegetic-document-forge.md` — AD-6, R-4, NFR-9.
- `pkg/vellum/src/render/surface.ts` — the sibling inline sigil desugar seam.
- `pkg/vellum/src/render/parse.ts` — `parseMarkdown`/`parseDocument`/`parseColumns`.
- `pkg/vellum/src/render/model.ts` — `VellumDocument`/`VellumNode`/`VellumBlock`/`VellumColumns`.

---

## 16. Completeness score

- **Draft (pre-challenge): ~62 / 100.** Coherent design and the right architecture
  (compile-to-canonical, additive), but the load-bearing **round-trip was asserted,
  not proven**; the colon formula was self-referential and contradicted the
  pseudocode; `:vsserr` was assumed to render without the required branch; title/
  reason escaping, the brace-matcher's full lexical states, docStore/share-link
  effects, and the attribute edge cases were unaddressed; "open questions: none" was
  premature.
- **Revised (this document): ~90 / 100.** All six blockers + the should-fixes
  resolved: explicit `:::column` with an **empirically verified** round-trip; a
  single, traced colon rule; the `vsserr` renderer branch + escaping sequenced into
  Phase 1; a complete brace-matcher lexical-state list (with the indented-code
  limitation stated, not hidden); `deriveTitle` VSS branch; an honest AD-6a/share-link
  scope; the full attribute/error/recognition matrix; idempotence + round-trip +
  fuzz tests. Remaining −10: the brace-matcher's lexical completeness is best
  *proven by the fuzz corpus during implementation* (a spec can enumerate but not
  exhaustively prove totality), and the Phase 3 formatter that fully restores AD-6
  portability is deferred.

The spec is implementation-ready: no unresolved questions, every hard problem has a
concrete rule, and Phase 1's gate (typecheck + tests + no-op-on-fixtures + round-trip)
is objectively checkable.
