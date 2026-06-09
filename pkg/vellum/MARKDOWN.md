# Vellum markdown dialect

A precise reference for the markdown flavor `@faerrin/vellum` parses and renders.
Written for AI agents (and humans) authoring documents. It describes **exactly
what the implementation does** — `src/render/parse.ts`, `src/render/mdastToReact.tsx`,
and the components in `src/render/components/`.

> TL;DR: it is **CommonMark + [`remark-directive`](https://github.com/remarkjs/remark-directive)**.
> **Ordinary CommonMark renders at the top level** (headings, lists, prose, …).
> `:::kind … :::` blocks of six fixed kinds render as PF2e cards. `:::columns`
> lays its `:::column` children side by side under shared headers. Inside a block
> you write CommonMark plus three inline directives (`:action`, `:trait`, `:redact`).

---

## 1. Mental model

1. A document is an ordered list of **nodes**, rendered top-to-bottom. A node is
   one of three things:
   - a **prose run** — ordinary top-level CommonMark (headings, lists, prose,
     blockquotes, …), rendered as document text;
   - a **block** — a *container directive* `:::kind[Title]{attrs}` … `:::` whose
     `kind` is one of the six below, rendered as a PF2e card;
   - a **columns layout** — a `:::columns` directive whose `:::column` children
     render **side by side** (see §4.1).
2. **Top-level markdown is kept**, in document order. A heading or list written
   between or above blocks renders where you put it. Unknown directives (a
   `:::kind` that isn't one of the six) degrade to prose rather than vanishing.
3. Inside a block you write normal CommonMark + the inline directives.
4. The **theme** (mechanical/diegetic) is **not** part of the markdown — it's a
   viewer/export setting (the editor toggle, or the render request's `mode`).
   Default is `mechanical`.

```
:::handout[Sealed Orders]      ← opens a block (kind=handout, title="Sealed Orders")
The bridge is out.             ← CommonMark body
:::                            ← closes the block (on its own line)
```

---

## 2. The six block kinds

| Kind | Family | Default use |
|------|--------|-------------|
| `statblock` | stat card | creatures / NPCs |
| `hazard` | stat card | traps / hazards |
| `item` | stat card | items |
| `spell` | stat card | spells |
| `handout` | prose card | in-world handouts |
| `edict` | prose card | proclamations / notices |

Syntax: `:::<kind>[Title]{attributes}` then body lines, then `:::` on its own line.
`[Title]` and `{attributes}` are both optional.

The `[Title]` may contain inline directives — most usefully an action glyph next
to the name: `:::item[Boots of Speed :action[free]]` renders the title with a
free-action glyph beside it. (The derived document title stays plain text — the
glyph shows only on the card.)

### Stat cards — `statblock`, `hazard`, `item`, `spell`

Recognized attributes (others are parsed but ignored):

| Attribute | Effect |
|-----------|--------|
| `traits="a,b,c"` | comma-separated trait pills (suppressed in diegetic mode) |
| `level=…` | shown beside the tag in the header, e.g. `ITEM 4` |
| `price=…` | a line in the body, under the header |
| `name=…` | title fallback when there's no `[Title]` label |
| `tag=…` | overrides the corner tag text (defaults to the kind, e.g. `item`) — e.g. `tag="Consumable"` |

```
:::statblock[Vox-Thrall Acolyte]{level="Creature 2" traits="undead,mindless"}
A hollowed servitor wired to a vox-caster.

## Actions
Strike :action[1] — a rusted blade.
Litany of Static :action[2] — a wave of grinding noise.
Flinch :action[reaction] — when struck, the thrall recoils.
:::
```

### Prose cards — `handout`, `edict`

Only `[Title]` is used (rendered as the heading). In diegetic mode they gain
parchment, a gold-leaf drop-cap on the first paragraph, and trait glyphs are
hidden.

```
:::handout[+++ Inquisitorial Dispatch +++]
The observatory has gone dark. Trust no transmission that does not bear the
second cipher.

— Interrogator Vael
:::
```

Multiple blocks in one document render top-to-bottom (separate them with a blank
line):

```
:::statblock[Goblin]
…
:::

:::handout[Note found on the body]
…
:::
```

---

## 3. Inline directives

These work **inside a block body** (and in a `[Title]` label — see §2). They use
`remark-directive` *text* directive syntax `:name[label]`.

| Directive | Renders | Notes |
|-----------|---------|-------|
| `:action[N]` | a PF2e action glyph (inline SVG) | `N` ∈ `1`,`2`,`3`,`reaction`,`free` (+ aliases below) |
| `:trait[name]` | a trait pill | any name allowed (a wax-red stamp in diegetic mode) |
| `:redact[text]` | a `[DATA EXPUNGED]` blackout bar over `text` | for diegetic props |

**Action cost tokens** (case-insensitive): `1`/`one`/`single`, `2`/`two`/`double`,
`3`/`three`/`triple`, `reaction`/`react`/`r`, `free`/`f`/`0`.

```
Cast :action[2], then Step :action[1] and Strike :action[reaction].
A :trait[fire] :trait[evocation] spell. The password is :redact[swordfish].
```

### 3.1 Shorthand sigils (recommended)

Three terse sigils expand to those directives before parsing — use these; they're
far easier to type and read. They're pure sugar (the line above and below render
identically):

| Sigil | Expands to | Example |
|-------|-----------|---------|
| `@N` | `:action[N]` | `Strike @1`, `@reaction`, `@free`, `@r`, `@f` |
| `#name` | `:trait[name]` | `a #fire #evocation spell` |
| `\|\|text\|\|` | `:redact[text]` | `the password is \|\|swordfish\|\|` |

```
Cast @2, then Step @1 and Strike @reaction.
A #fire #evocation spell. The password is ||swordfish||.
```

**Scoping** (so ordinary prose doesn't trigger them):

- `@` only fires on a **known action token** and not when it follows a letter —
  so `@2`/`@free` convert, but `email@host`, `@everyone`, `@dawn`, and `@2d6` do not.
- `#name` needs a letter right after `#` and whitespace before it — so `#fire`
  converts, but `# Heading`, `## Actions`, `C#`, and `#123` do not.
- `||…||` is a single line of any text. (GFM tables use single `|`, so they're safe.)

**Limitations:** sigils are expanded everywhere, including inside `` `code spans` ``
and `||…||`. If you need a literal `@2` or `#word` to survive, write the canonical
`:action[2]` / `:trait[word]` form instead.

A malformed or unknown inline directive (e.g. `:action[seven]`, `:trait[]`, or any
unrecognized `:name[…]`) renders a small visible **error chip** like `?action[seven]`
— it never throws or blanks the document. Use this as your signal that something
is mistyped.

---

## 4. CommonMark you can use (top level **and** inside a block)

All standard CommonMark works both at the document top level and in a block body:

- Headings `#`–`######`. **At the top level they scale by level** — `#` is the
  largest (a ruled document title), down to `######` — so heading depth expresses
  real hierarchy. **Inside a card** the same headings render as flat, uniform
  section labels (e.g. `## Actions`), keeping the stat layout tight.
- `**bold**`, `*italic*`, `` `inline code` ``
- Fenced ```` ``` ```` and indented code blocks
- `> blockquotes`
- Ordered (`1.`) and unordered (`-`, `*`) lists
- Links `[text](https://…)` and autolinks `<https://…>`
- Images `![alt](url)` — **alt text only is rendered; the image is never fetched**
  (a deliberate no-SSRF rule). Don't rely on external images.
- Thematic breaks `---`, hard line breaks (two trailing spaces), entities `&amp;`

### 4.1 Columns — side-by-side layout

`:::columns` lays out equal-width tracks side by side. Anything *outside* the
columns (e.g. a heading above it) spans the full page, so the columns sit **under
a shared header**. A column can hold anything a document can: prose, several
`:::kind` cards, lists, even nested columns.

**The recommended syntax: put your content directly inside `:::columns` and
separate columns with a `---` divider.** Each column holds as many elements as
you like — they stack in order.

```
# Encounter: The Drowned Vault     ← full-width heading, above the columns

::::columns
:::statblock[Goblin A]{level="Creature 1"}
First card.
:::
:::statblock[Goblin B]{level="Creature 1"}
Second card — stacked under the first, SAME column.
:::

---                                ← column break

## Right brief
- two guards
- one cogitator-lock
::::
```

> **The one rule:** the `:::columns` fence needs **more colons than the blocks
> inside it.** Cards use three colons (`:::statblock`), so wrap them in a
> **four**-colon `::::columns`. Add a colon for every extra nesting level. If you
> use the *same* colon count for `:::columns` and a block inside it, the block's
> closing `:::` ends the columns early — that's why a second `:::item` would
> "disappear". When in doubt, give `:::columns` extra colons.

A `---` inside `:::columns` is always a column break (you can't also use it as a
horizontal rule there). No `---` at all → a single column.

**Alternative — explicit `:::column` containers.** If you prefer named columns,
each `:::column` child is a column. This needs one *more* colon level than the
`---` style (`:::::columns` → `::::column` → `:::statblock`), so the `---` form is
usually easier:

```
:::::columns
::::column
left
::::
::::column
right
::::
:::::
```

Two-or-more columns are supported (tracks size to the column count); narrow
viewports collapse them to a single stack in the live preview (PNG export keeps
the full width). A `[label]` on a `:::column` is **ignored** (columns have no
header of their own — put any heading inside the column). `:::columns`/`:::column`
are **layout-only and top-level**: written inside a `:::kind` card, or orphaned
without a `:::columns` parent, they render their content with a visible `?…`
error chip instead of laying out.

> **Tired of counting colons?** The **Structured syntax (§5)** writes the same
> layout as `@columns [ {…} {…} ]` and computes the fence depth for you.

### 4.2 GitHub-Flavored Markdown

**GFM is on** (`remark-gfm`), so the GitHub extensions all work, top level and in
a block body:

- **Tables** — pipe tables with an alignment row. The first row is the header;
  `:---`, `---:`, `:---:` set left/right/center alignment per column.

  ```
  | Ability | Mod |
  |:--------|----:|
  | Str     | +4  |
  | Dex     | +2  |
  ```
- **Strikethrough** — `~~struck~~`.
- **Task lists** — `- [x]` / `- [ ]` render checkboxes (read-only).
- **Autolink literals** — bare `https://…` and `www.…` URLs become links (no
  fetch happens; for PNG export they're inert).
- **Footnotes** — `text[^id]` with a `[^id]: definition` block; the reference
  renders as a superscript `[id]` and definitions render below.

### Not supported

- **Raw HTML is inert.** Any `<tag>` or `<script>` is rendered as escaped text,
  never as HTML (a security rule). Don't use HTML for layout.

---

## 5. Structured syntax (VSS) — braces for structure

**Vellum Structured Syntax (VSS)** is a brace/bracket surface for the *structure*
of a document — blocks and columns — so you never count colons. It **compiles to
the canonical `:::` directives** above before anything else runs; markdown + GFM +
the inline sigils stay the language of **content** inside `{ … }` bodies. The
`/statblock`, `/item`, `/columns`, … snippets now scaffold VSS.

> **Design axiom: braces for STRUCTURE, markdown for CONTENT.** VSS never
> reimplements markdown — it emits canonical directive markdown and hands bodies
> to the renderer verbatim. The model and the rendered cards are identical to the
> `:::` form.

### 5.1 Blocks

```
@item "Reinforced Bulkheads"
| price: 30 Energy
| level: 1
{
  The Fortitude DC of the base camp increases by **+2**.
}
```

- **`@kind "Title"`** opens a block. `kind` is one of the six
  (`statblock`/`hazard`/`item`/`spell`/`handout`/`edict`); the quoted title
  becomes the `[label]` and may carry sigils (`@item "Look Out @reaction"`).
- **`| key: value`** lines — one attribute per line, **between the title and the
  `{`**. The value is the rest of the line (so `level: Creature 2` works); split on
  the first `:`. `traits: a, b` → `traits="a,b"`. A `|` line *after* the `{` is
  ordinary body text, not an attribute.
- **`{ … }`** is the body: any markdown, sigils, and **nested** blocks/columns.

### 5.2 Columns

```
@columns [
  {
    ## Tier I
    @item "Reinforced Bulkheads"
    | price: 30 Energy
    { The Fortitude DC increases by **+2**. }
  }
  {
    ## Tier 2
    @item "Alarm Wards"
    | price: 35 Energy
    { Stealth checks suffer a **-2** penalty. }
  }
]
```

`@columns [ {…} {…} ]` — **each `{ }` is one column** (hold as many cards/paragraphs
as you like). VSS computes the fence depth from brace nesting, so the colon-count
footgun from §4.1 is gone: the example above compiles to `:::::columns` →
`::::column` → `:::item` automatically.

### 5.3 Braces, escapes, and code

The matcher finds the `}` that *matches* the opening `{`, not the first one. It
tracks markdown so structural braces count but content braces don't:

- **Balanced braces in prose nest** (`press {the} key`). For a **lone** literal
  brace, escape it: `\{` / `\}` (kept escaped in the output).
- **Braces inside inline code (`` `{` ``) and fenced code blocks are ignored**
  (a `~~~` fence may even contain ```` ``` ````).
- **4-space indented code is *not* tracked** — a `}` there closes the body early.
  Use a *fenced* block for brace-bearing code in a body.
- A bare canonical `:::` fence **inside** a VSS body is rejected (use VSS braces to
  nest, not `:::`).

### 5.4 Errors never throw

Any malformed VSS compiles to a visible **error chip** `?…` instead of throwing or
blanking the document — a missing title, a body that never opens, an unterminated
`{`/`[`, an attribute value containing `"`/`}`, nesting past the depth cap, etc.
An **unknown** `@kind` (e.g. `@monster "x"`) is left as literal text.

### 5.5 Portability (AD-6a) — the one trade-off

Canonical `:::` and the inline sigils stay **valid-ish CommonMark** and degrade
gracefully in a vanilla viewer (aether/Obsidian). **VSS source does not degrade** —
`@columns [ … ]` is garbage outside vellum. VSS is therefore an **opt-in** surface:
authoring in it trades portability for structure, scoped to vellum-rendered
contexts (editor preview, render service, share links). Nothing forces VSS on
existing content, and the **⇄ Syntax** toolbar button converts both ways on
demand: VSS → canonical (`compileVss`, always exact) for portable export, and
canonical → VSS (`canonicalToVss`, conservative — anything that wouldn't
round-trip model-identically is left canonical).

---

## 6. Directive syntax rules (reference)

`remark-directive` defines three nesting levels — vellum uses two of them:

| Form | Level | Vellum meaning |
|------|-------|----------------|
| `:::name` … `:::` | container (multi-line block) | the six document kinds (top level only) |
| `:name[label]` | text (inline) | `:action` / `:trait` / `:redact` |
| `::name` | leaf (one line) | also accepted for `action`, but inline `:action` is idiomatic |

**Label** — `[…]` after the name: the block Title, or the inline directive's value.

**Attributes** — `{…}` after the name/label:
- `key=value` pairs; **quote any value containing spaces or commas**:
  `{level="Creature 1" traits="undead,fire"}`. Unquoted single tokens are fine:
  `{level=5}`.
- `#id` and `.class` shorthands are parsed but vellum ignores them.

Container fences: the opening `:::name[…]{…}` is one line; the closing fence is on
its own line. Use three colons for a standalone block; when **nesting**
containers (columns), the outer fence needs **more** colons than what it holds —
see §4.1.

---

## 7. Theme modes (not markdown)

`mechanical` (teal cogitator-dataslate, default) vs `diegetic` (amber Imperial
parchment) is chosen in the editor toolbar or the export request — **there is no
in-document syntax for it**, and no YAML frontmatter is parsed. The *same* source
renders in either skin; diegetic adds parchment, a drop-cap, hides trait glyphs,
and applies deterministic "grime" (slight rotation + a stain) seeded from the
document's content, so the same text always exports the same image.

---

## 8. Gotchas (read before authoring)

- **Top-level markdown renders now.** Notes, headings, and lists between/around
  blocks *do* appear in the output and export — they're no longer dropped. If you
  want a scratch note to stay out of the export, delete it; there's no comment
  syntax that hides it.
- **A block's kind must be exact.** A `:::statblock` nested inside a list/blockquote,
  or a directive whose kind isn't one of the six, won't render as a card — an
  unknown `:::kind` falls back to plain prose. Keep card blocks at the top level
  (or inside a `:::column`) with the exact kind names.
- **Columns need outward-increasing colons** (§4.1). Three colons everywhere
  closes the layout after the first column.
- **A colon before a letter can start an inline directive.** `:gate` in prose is
  parsed as a text directive (`:name`) and, being unknown, shows an error chip.
  If you need a literal colon-word, escape the colon (`\:gate`) or reword. Normal
  prose colons (`10:30`, `Note: …` with a following space/number) are fine.
- **Quote attribute values with spaces/commas** or parsing splits them.
- **Error chips are intentional feedback** — if you see `?something`, fix that
  directive; the rest of the document is unaffected.
- **No external assets.** Images and remote fonts/styles are not loaded; rely
  only on text + the built-in glyphs/pills.

---

## 9. Complete annotated example

```
:::statblock[Censer-Wraith]{level="Creature 4" traits="undead,incorporeal,fire"}
A coil of burning incense-smoke that remembers being a priest.

**Perception** +11; darkvision
**Languages** understands High Gothic

## Actions
Smoke Lash :action[1] — reach 10 ft, 2d6 fire.
Choking Litany :action[2] — a 15-ft cone of searing ash.
Dissipate :action[reaction] — when hit by wind, it flickers away.
:::

:::handout[+++ Vox-transcript, partial +++]
…signal degraded… the censer still *burns* in the nave, and the password to
the reliquary is :redact[ashes to ashes]. Do not approach without the second
cipher.

— recovered from a dead astropath
:::
```

- Two blocks → two cards, top to bottom.
- The statblock shows three trait pills, a `Creature 4` meta line, `## Actions`
  as a section label, and three action glyphs.
- The handout shows a title and prose; in diegetic mode it gets parchment, a
  drop-cap on "…signal", a redaction bar over "ashes to ashes", and no trait
  glyphs.

---

## 10. Cheat sheet

```
:::statblock[Name]{level="Creature 1" traits="a,b"}   # statblock | hazard | item | spell
…body…                                                 #   attrs: traits, level (header), price (body), tag, name
:::

:::handout[Title]                                      # handout | edict (prose; drop-cap in diegetic)
…body…
:::

@2   @reaction   @free                                 # action glyph  (= :action[…])
#fire                                                  # trait pill    (= :trait[fire])
||secret||                                             # redaction bar (= :redact[secret])

# Heading  - list  > quote  **bold**  [t](url)  ~~del~~   # CommonMark + GFM (tables, tasks, footnotes); HTML inert

| A | B |                                              # GFM table (`:--`/`--:`/`:-:` set alignment)
|--:|:--|
| 1 | 2 |

::::columns                                            # side-by-side (outer fence > inner block colons)
left column                                            #   `---` separates columns; blocks stack per column
---
right column
::::
```
