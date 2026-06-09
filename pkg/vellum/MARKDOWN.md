# Vellum markdown dialect

A precise reference for the markdown flavor `@faerrin/vellum` parses and renders.
Written for AI agents (and humans) authoring documents. It describes **exactly
what the implementation does** — `src/render/parse.ts`, `src/render/mdastToReact.tsx`,
and the components in `src/render/components/`.

> TL;DR: it is **CommonMark + [`remark-directive`](https://github.com/remarkjs/remark-directive)**.
> The only things that render are top-level `:::kind … :::` blocks of six fixed
> kinds; everything else at the top level is dropped. Inside a block you write
> ordinary CommonMark plus three inline directives (`:action`, `:trait`, `:redact`).

---

## 1. Mental model

1. A document is a list of **blocks**. A block is a top-level *container directive*
   `:::kind[Title]{attrs}` … `:::` whose `kind` is one of the six below.
2. **Only those six container kinds, and only at the top level, produce output.**
   Loose prose, blockquotes, headings, lists, or unknown directives written
   *outside* a block are **silently ignored** (not rendered, not exported).
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

### Stat cards — `statblock`, `hazard`, `item`, `spell`

Recognized attributes (others are parsed but ignored):

| Attribute | Effect |
|-----------|--------|
| `traits="a,b,c"` | comma-separated trait pills (suppressed in diegetic mode) |
| `level=…` / `rank=…` / `price=…` | a meta line under the header (first one present wins) |
| `name=…` | title fallback when there's no `[Title]` label |

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

These work **inside a block body**. They use `remark-directive` *text* directive
syntax `:name[label]`.

| Directive | Renders | Notes |
|-----------|---------|-------|
| `:action[N]` | a PF2e action glyph (inline SVG) | `N` ∈ `1`,`2`,`3`,`reaction`,`free` (+ aliases below) |
| `:trait[name]` | a trait pill | hidden in diegetic mode; any name allowed |
| `:redact[text]` | a `[DATA EXPUNGED]` blackout bar over `text` | for diegetic props |

**Action cost tokens** (case-insensitive): `1`/`one`/`single`, `2`/`two`/`double`,
`3`/`three`/`triple`, `reaction`/`react`/`r`, `free`/`f`/`0`.

```
Cast :action[2], then Step :action[1] and Strike :action[reaction].
A :trait[fire] :trait[evocation] spell. The password is :redact[swordfish].
```

A malformed or unknown inline directive (e.g. `:action[seven]`, `:trait[]`, or any
unrecognized `:name[…]`) renders a small visible **error chip** like `?action[seven]`
— it never throws or blanks the document. Use this as your signal that something
is mistyped.

---

## 4. CommonMark you can use (inside a block)

All standard CommonMark works in a block body:

- Headings `#`–`######` (used as section labels, e.g. `## Actions`)
- `**bold**`, `*italic*`, `` `inline code` ``
- Fenced ```` ``` ```` and indented code blocks
- `> blockquotes`
- Ordered (`1.`) and unordered (`-`, `*`) lists
- Links `[text](https://…)` and autolinks `<https://…>`
- Images `![alt](url)` — **alt text only is rendered; the image is never fetched**
  (a deliberate no-SSRF rule). Don't rely on external images.
- Thematic breaks `---`, hard line breaks (two trailing spaces), entities `&amp;`

### Not supported

- **GitHub-Flavored extensions are OFF** (no `remark-gfm`): no tables, no
  `~~strikethrough~~`, no `- [ ]` task lists, no bare-URL autolinks. Write tables
  as plain text / lists; use `<https://…>` for links.
- **Raw HTML is inert.** Any `<tag>` or `<script>` is rendered as escaped text,
  never as HTML (a security rule). Don't use HTML for layout.

---

## 5. Directive syntax rules (reference)

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

Container fences: the opening `:::name[…]{…}` is one line; the closing `:::` is on
its own line. Use exactly three colons for blocks.

---

## 6. Theme modes (not markdown)

`mechanical` (teal cogitator-dataslate, default) vs `diegetic` (amber Imperial
parchment) is chosen in the editor toolbar or the export request — **there is no
in-document syntax for it**, and no YAML frontmatter is parsed. The *same* source
renders in either skin; diegetic adds parchment, a drop-cap, hides trait glyphs,
and applies deterministic "grime" (slight rotation + a stain) seeded from the
document's content, so the same text always exports the same image.

---

## 7. Gotchas (read before authoring)

- **Top-level only.** A `:::statblock` nested inside a list/blockquote, or a
  block whose kind isn't one of the six, is **not** rendered. Keep blocks at the
  document's top level with the exact kind names.
- **Content outside blocks is dropped.** Notes, prose, or comments between/around
  blocks won't appear in the output or export. Put everything inside a block.
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

## 8. Complete annotated example

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

## 9. Cheat sheet

```
:::statblock[Name]{level="Creature 1" traits="a,b"}   # statblock | hazard | item | spell
…body…                                                 #   attrs: traits, level/rank/price, name
:::

:::handout[Title]                                      # handout | edict (prose; drop-cap in diegetic)
…body…
:::

:action[2]   :action[reaction]   :action[free]         # inline action glyph
:trait[fire]                                           # inline trait pill
:redact[secret]                                        # inline blackout

**bold**  *italic*  `code`  > quote  - list  [t](url)  ## Heading   # CommonMark only (no GFM/HTML)
```
