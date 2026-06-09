import { Prec, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Editor syntax highlighting in the @faerrin/gothic palette (NFR-3: colors via
 * CSS vars, no hex). Two layers:
 *   1. a HighlightStyle re-theming the markdown tokens lezer-markdown emits
 *      (headings, emphasis, code, links, …) to the amber/teal skin, and
 *   2. a regex ViewPlugin that decorates vellum's own directive syntax — which
 *      the markdown grammar doesn't know about — so `:::kind` fences, inline
 *      `:action`/`:trait`/`:redact`, labels, and attributes read at a glance.
 */

// ── 1. Markdown tokens, re-themed ──────────────────────────────────────────
const gothicMarkdown = HighlightStyle.define([
  {
    tag: [
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
      t.heading,
    ],
    color: "var(--accent)",
    fontWeight: "600",
  },
  // Markdown punctuation: `#`, `*`, `-`, `>`, ``` ``` ```, list bullets, etc.
  { tag: t.processingInstruction, color: "var(--ink-faint)" },
  { tag: t.strong, color: "var(--ink)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--ink)", fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: t.monospace, color: "var(--accent-amber)" }, // inline code + fences
  { tag: t.contentSeparator, color: "var(--rule-bright)" }, // `---`
  { tag: t.quote, color: "var(--ink-dim)" },
]);

// ── 2. Vellum directive syntax ─────────────────────────────────────────────
const fenceMark = Decoration.mark({ class: "cm-vellum-fence" });
const labelMark = Decoration.mark({ class: "cm-vellum-label" });
const attrMark = Decoration.mark({ class: "cm-vellum-attr" });
const inlineMark = Decoration.mark({ class: "cm-vellum-inline" });
const inlineUnknownMark = Decoration.mark({ class: "cm-vellum-inline-unknown" });

/** `:::name`/`::::columns` opener — colons + directive name. */
const OPEN_FENCE = /^(:{3,})([A-Za-z][\w-]*)/;
/** A bare closing fence line, `:::` (any colon count). */
const CLOSE_FENCE = /^:{3,}\s*$/;
/** `[label]` and `{attributes}` trailing a directive opener. */
const LABEL = /\[[^\]\n]*\]/;
const ATTRS = /\{[^}\n]*\}/;
/** Inline directive token, `:action[…]` / `:trait[…]` / `:foo[…]`. */
const INLINE = /:([A-Za-z][\w-]*)\[[^\]\n]*\]/g;
const KNOWN_INLINE = new Set(["action", "trait", "redact"]);
/** Authoring sigils (kept in sync with surface.ts `desugar`): `@action`,
 * `||redact||`, `#trait`. Highlighted like the directives they expand to. */
const SIGIL =
  /(?<![\w@])@(?:reaction|react|free|single|double|triple|one|two|three|[0-3rf])\b|\|\|[^|\n]+\|\||(?<![\w#])#[A-Za-z][\w-]*/gi;

function buildDecorations(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const open = OPEN_FENCE.exec(text);

      if (open) {
        // `:::name` (+ optional `[label]` and `{attrs}` after the name).
        out.push(fenceMark.range(line.from, line.from + open[0].length));
        const rest = text.slice(open[0].length);
        const lab = LABEL.exec(rest);
        if (lab) {
          const start = line.from + open[0].length + lab.index;
          out.push(labelMark.range(start, start + lab[0].length));
        }
        const at = ATTRS.exec(rest);
        if (at) {
          const start = line.from + open[0].length + at.index;
          out.push(attrMark.range(start, start + at[0].length));
        }
      } else if (CLOSE_FENCE.test(text)) {
        out.push(fenceMark.range(line.from, line.from + text.trimEnd().length));
      } else {
        // Inline directives anywhere in a body line.
        INLINE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INLINE.exec(text))) {
          const known = KNOWN_INLINE.has(m[1]!.toLowerCase());
          const start = line.from + m.index;
          out.push(
            (known ? inlineMark : inlineUnknownMark).range(
              start,
              start + m[0].length,
            ),
          );
        }
        // Authoring sigils (the terse forms that desugar to those directives).
        SIGIL.lastIndex = 0;
        let s: RegExpExecArray | null;
        while ((s = SIGIL.exec(text))) {
          const start = line.from + s.index;
          out.push(inlineMark.range(start, start + s[0].length));
        }
      }

      pos = line.to + 1;
    }
  }

  // `true` → let RangeSet sort; marks never overlap so order is unambiguous.
  return Decoration.set(out, true);
}

const directivePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const directiveTheme = EditorView.baseTheme({
  ".cm-vellum-fence": { color: "var(--accent)", fontWeight: "600" },
  ".cm-vellum-label": { color: "var(--accent-amber)" },
  ".cm-vellum-attr": { color: "var(--ink-dim)" },
  ".cm-vellum-inline": { color: "var(--accent-amber)", fontWeight: "600" },
  // Unknown inline directive: still tinted, but flagged as "this will error".
  ".cm-vellum-inline-unknown": {
    color: "var(--ink-dim)",
    textDecoration: "underline wavy var(--wax)",
  },
});

/**
 * Full editor highlighting extension. `Prec.high` lets the gothic markdown
 * style win over basicSetup's default highlight style for the tags we define.
 */
export const vellumHighlighting: Extension = [
  Prec.high(syntaxHighlighting(gothicMarkdown)),
  directivePlugin,
  directiveTheme,
];
