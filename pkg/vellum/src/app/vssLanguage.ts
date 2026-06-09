/**
 * VSS editor grammar (spec Phase 3, §10). An `@lezer/markdown` extension that
 * parses the VSS structural surface into real syntax-tree nodes, replacing the
 * Phase-2 regex decorations for VSS. Mirroring the compiler's philosophy —
 * braces for structure, markdown for content — it *extends* the editor's
 * markdown grammar with block parsers for the structural lines only; body
 * content stays ordinary markdown (so emphasis, headings, sigils, etc. inside
 * a `{ … }` body keep their normal highlighting).
 *
 * Nodes produced (all line-scoped):
 *  - `VSSBlock`   — `@kind "Title"` opener (children `VSSKind`, `VSSTitle`)
 *  - `VSSColumns` — `@columns [` opener (child `VSSKind`)
 *  - `VSSAttr`    — `| key: value` line (child `VSSAttrKey` over `| key:`)
 *  - `VSSBrace`   — a lone structural `{` / `}` / `]` line
 *
 * Faithfulness to the compiler (`render/vss.ts`):
 *  - openers only at line start (modulo indentation) with a kind from the
 *    closed `DOCUMENT_KINDS` set — `@everyone`, `@reaction`, `@items` don't match;
 *  - openers interrupt paragraphs (the compiler recognizes them mid-prose at
 *    line start); attr/brace lines do NOT (mid-paragraph they're body text);
 *  - attr lines need `| key:` and no second `|`, so GFM table rows never match.
 */

import type {
  BlockContext,
  Line,
  LeafBlock,
  MarkdownConfig,
} from "@lezer/markdown";
import { Tag } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { DOCUMENT_KINDS } from "../render/index.ts";

const KINDS = DOCUMENT_KINDS.join("|");
/** `@kind "Title…"` — title quote-run is part of the match when present. */
const OPENER = new RegExp(`^@(${KINDS})\\b(\\s+"(?:[^"\\\\\\n]|\\\\.)*")?`);
const COLUMNS = /^@columns\b/;
/** `| key:` with no second pipe on the line (tables stay tables). */
const ATTR = /^(\|\s*[A-Za-z][\w-]*\s*:)(?!.*\|)/;
/** A lone structural brace/bracket line. */
const BRACE = /^[{}\]]\s*$/;

// ── highlight tags (custom, so they can't collide with markdown content) ───
const kindTag = Tag.define();
const titleTag = Tag.define();
const attrKeyTag = Tag.define();
const braceTag = Tag.define();

/** Maps the VSS node tags onto the gothic palette (NFR-3: vars, no hex),
 * matching the canonical-directive decoration colors in vellumHighlight. */
export const vssHighlighting: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: kindTag, color: "var(--accent)", fontWeight: "600" },
    { tag: titleTag, color: "var(--accent-amber)" },
    { tag: attrKeyTag, color: "var(--ink-dim)" },
    { tag: braceTag, color: "var(--accent)", fontWeight: "600" },
  ]),
);

function isOpener(text: string): boolean {
  return OPENER.test(text) || COLUMNS.test(text);
}

/** Claim the rest of the current line as `type` with the given children. */
function claimLine(
  cx: BlockContext,
  line: Line,
  type: string,
  children: { type: string; from: number; to: number }[],
): true {
  const from = cx.lineStart + line.pos;
  const to = cx.lineStart + line.text.length;
  cx.addElement(
    cx.elt(
      type,
      from,
      to,
      children.map((c) => cx.elt(c.type, c.from, c.to)),
    ),
  );
  cx.nextLine();
  return true;
}

function parseVssOpener(cx: BlockContext, line: Line): boolean {
  if (line.next !== 64 /* @ */) return false;
  const text = line.text.slice(line.pos);
  const from = cx.lineStart + line.pos;

  const cols = COLUMNS.exec(text);
  if (cols) {
    return claimLine(cx, line, "VSSColumns", [
      { type: "VSSKind", from, to: from + cols[0].length },
    ]);
  }

  const m = OPENER.exec(text);
  if (!m) return false;
  const children = [
    { type: "VSSKind", from, to: from + 1 + m[1]!.length },
  ];
  if (m[2]) {
    const open = text.indexOf('"', 1 + m[1]!.length);
    children.push({
      type: "VSSTitle",
      from: from + open,
      to: from + m[0].length,
    });
  }
  return claimLine(cx, line, "VSSBlock", children);
}

function parseVssAttr(cx: BlockContext, line: Line): boolean {
  if (line.next !== 124 /* | */) return false;
  const m = ATTR.exec(line.text.slice(line.pos));
  if (!m) return false;
  const from = cx.lineStart + line.pos;
  return claimLine(cx, line, "VSSAttr", [
    { type: "VSSAttrKey", from, to: from + m[1]!.length },
  ]);
}

function parseVssBrace(cx: BlockContext, line: Line): boolean {
  const c = line.next;
  if (c !== 123 /* { */ && c !== 125 /* } */ && c !== 93 /* ] */) return false;
  if (!BRACE.test(line.text.slice(line.pos))) return false;
  return claimLine(cx, line, "VSSBrace", []);
}

/** The parser extension: pass to `markdown({ extensions: vssMarkdown })`. */
export const vssMarkdown: MarkdownConfig = {
  defineNodes: [
    { name: "VSSBlock", block: true },
    { name: "VSSColumns", block: true },
    { name: "VSSAttr", block: true },
    { name: "VSSBrace", block: true, style: braceTag },
    { name: "VSSKind", style: kindTag },
    { name: "VSSTitle", style: titleTag },
    { name: "VSSAttrKey", style: attrKeyTag },
  ],
  parseBlock: [
    {
      name: "VSSOpener",
      parse: parseVssOpener,
      // The compiler recognizes an opener at line start even mid-paragraph.
      endLeaf: (_cx: BlockContext, line: Line, _leaf: LeafBlock) =>
        line.next === 64 && isOpener(line.text.slice(line.pos)),
      // Run before IndentedCode so an indented opener is VSS, not code —
      // the compiler also accepts leading whitespace.
      before: "IndentedCode",
    },
    { name: "VSSAttrLine", parse: parseVssAttr, before: "IndentedCode" },
    {
      name: "VSSBraceLine",
      parse: parseVssBrace,
      // A lone `}` directly under body text closes the body in the compiler
      // (no blank line needed), so it must interrupt paragraphs here too.
      endLeaf: (_cx: BlockContext, line: Line, _leaf: LeafBlock) =>
        BRACE.test(line.text.slice(line.pos)),
      before: "IndentedCode",
    },
  ],
};
