import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import type { Root, RootContent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  type ThemeMode,
  type VellumColumns,
  type VellumDocument,
  type VellumNode,
} from "./model.ts";

/** Container-directive names that drive layout rather than naming a kind. */
const COLUMNS_NAME = "columns";
const COLUMN_NAME = "column";

const processor = unified().use(remarkParse).use(remarkDirective);

/** Parse markdown (+ directive syntax) into an mdast tree. Pure. */
export function parseMarkdown(source: string): Root {
  return processor.parse(source) as Root;
}

function isKind(name: string): name is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(name);
}

function normalizeAttributes(
  attrs: ContainerDirective["attributes"],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) out[key] = value;
  }
  return out;
}

/**
 * mdast-util-directive marks the `[label]` of a directive as the first child
 * paragraph carrying `data.directiveLabel === true`. Split it off the content.
 */
function splitLabel(directive: ContainerDirective): {
  label?: string;
  children: RootContent[];
} {
  const [first, ...rest] = directive.children;
  if (first?.type === "paragraph" && first.data?.directiveLabel) {
    const label = first.children
      .map((node) => (node.type === "text" ? node.value : ""))
      .join("")
      .trim();
    return { label: label || undefined, children: rest };
  }
  return { children: directive.children };
}

/**
 * Parse an ordered list of mdast nodes into vellum nodes:
 *  - `:::kind` containers become kind blocks,
 *  - `:::columns` containers become side-by-side layouts (recursively),
 *  - everything else is loose markdown, grouped into prose runs so that
 *    document order is preserved (e.g. a heading sitting above a columns block).
 * Pure and total — unknown directives just fall through as prose.
 */
function parseNodes(content: readonly RootContent[]): VellumNode[] {
  const nodes: VellumNode[] = [];
  let prose: RootContent[] = [];

  const flushProse = () => {
    if (prose.length > 0) {
      nodes.push({ type: "prose", children: prose });
      prose = [];
    }
  };

  for (const node of content) {
    if (node.type === "containerDirective" && isKind(node.name)) {
      flushProse();
      const { label, children } = splitLabel(node);
      nodes.push({
        type: "block",
        kind: node.name,
        attributes: normalizeAttributes(node.attributes),
        label,
        children,
      });
    } else if (
      node.type === "containerDirective" &&
      node.name === COLUMNS_NAME
    ) {
      flushProse();
      nodes.push(parseColumns(node));
    } else {
      prose.push(node);
    }
  }

  flushProse();
  return nodes;
}

/**
 * Parse a `:::columns` container into a side-by-side layout. Two author styles
 * are accepted (whichever is present):
 *
 *  - **`---` dividers (recommended):** put blocks/prose directly inside the
 *    `:::columns` body and separate columns with a `---` thematic break. This
 *    only needs the columns fence to out-colon the blocks inside it (e.g.
 *    `::::columns` around `:::item` blocks) — one bump, so multiple blocks per
 *    column "just work".
 *  - **`:::column` containers (explicit):** each `:::column` child is a column.
 *    This needs an extra colon level (`:::::columns` → `::::column` → block).
 *
 * Falls back to a single column if neither divider is present, so content is
 * never dropped. Pure and total.
 */
function parseColumns(directive: ContainerDirective): VellumColumns {
  const children = directive.children;
  const columns: VellumNode[][] = [];

  const explicit = children.filter(
    (child) => child.type === "containerDirective" && child.name === COLUMN_NAME,
  );

  if (explicit.length > 0) {
    for (const child of explicit) {
      // A column may carry an optional `[label]` we don't render — drop it.
      const { children: inner } = splitLabel(child as ContainerDirective);
      columns.push(parseNodes(inner));
    }
  } else {
    // Split the body on `---` dividers; each run between breaks is a column.
    let group: RootContent[] = [];
    for (const node of children) {
      if (node.type === "thematicBreak") {
        columns.push(parseNodes(group));
        group = [];
      } else {
        group.push(node);
      }
    }
    columns.push(parseNodes(group));
  }

  if (columns.length === 0) {
    columns.push(parseNodes(children));
  }

  return {
    type: "columns",
    attributes: normalizeAttributes(directive.attributes),
    columns,
  };
}

/**
 * Parse a document source into the vellum model. Top-level `:::kind` containers
 * become blocks, `:::columns` become side-by-side layouts, and all other
 * top-level markdown (headings, lists, prose) is kept as prose runs in document
 * order. Mode defaults to mechanical; `opts.mode` overrides. Rules-illiterate —
 * content is carried verbatim and the parser never throws.
 */
export function parseDocument(
  source: string,
  opts?: { mode?: ThemeMode },
): VellumDocument {
  const root = parseMarkdown(source);
  return { mode: opts?.mode ?? "mechanical", nodes: parseNodes(root.children) };
}
