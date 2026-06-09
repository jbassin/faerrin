import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import type { Root, RootContent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import {
  DOCUMENT_KINDS,
  type DocumentKind,
  type ThemeMode,
  type VellumBlock,
  type VellumDocument,
} from "./model.ts";

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
 * Parse a document source into the vellum model: top-level container directives
 * whose name is a known kind become blocks. Mode defaults to mechanical (M1);
 * `opts.mode` overrides. Rules-illiterate — content is carried verbatim.
 */
export function parseDocument(
  source: string,
  opts?: { mode?: ThemeMode },
): VellumDocument {
  const root = parseMarkdown(source);
  const blocks: VellumBlock[] = [];

  for (const node of root.children) {
    if (node.type === "containerDirective" && isKind(node.name)) {
      const { label, children } = splitLabel(node);
      blocks.push({
        kind: node.name,
        attributes: normalizeAttributes(node.attributes),
        label,
        children,
      });
    }
  }

  return { mode: opts?.mode ?? "mechanical", blocks };
}
