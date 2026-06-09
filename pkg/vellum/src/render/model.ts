import type { RootContent } from "mdast";

/**
 * Theme axis. mechanical = teal cogitator-dataslate; diegetic = amber Imperial
 * parchment. M1 renders mechanical only; the prop is threaded for M4.
 */
export type ThemeMode = "mechanical" | "diegetic";

/** The fixed document "zoo". */
export const DOCUMENT_KINDS = [
  "statblock",
  "hazard",
  "item",
  "spell",
  "handout",
  "edict",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Default theme mode for each kind (mechanical for rules, diegetic for props). */
export const DEFAULT_MODE_BY_KIND: Record<DocumentKind, ThemeMode> = {
  statblock: "mechanical",
  hazard: "mechanical",
  item: "mechanical",
  spell: "mechanical",
  handout: "diegetic",
  edict: "diegetic",
};

/**
 * One parsed document block from a `:::kind` directive. `children` is the
 * block's inner markdown content as mdast nodes — the React layer renders it.
 * The model is rules-illiterate: it carries the author's text/attributes
 * verbatim and never evaluates a number.
 */
export interface VellumBlock {
  type: "block";
  kind: DocumentKind;
  /** Directive attributes, e.g. `:::statblock{level=5 rarity=unique}`. */
  attributes: Record<string, string>;
  /** Optional inline label from `:::statblock[Label]`. */
  label?: string;
  /** Inner content nodes (prose, lists, inline directives). */
  children: RootContent[];
}

/**
 * A run of loose top-level markdown — headings, lists, prose, blockquotes,
 * etc. — that lives outside any directive. Consecutive loose nodes are grouped
 * into one run so document order (e.g. a heading above some columns) survives.
 */
export interface VellumProse {
  type: "prose";
  /** Loose markdown nodes, rendered verbatim by mdastToReact. */
  children: RootContent[];
}

/**
 * Side-by-side layout from a `:::columns` directive. Each column is itself an
 * ordered list of nodes, so a column can hold prose, `:::kind` blocks, and even
 * nested columns (recursive). Authoring uses nested directive fences — the
 * outer fence needs MORE colons than what it contains (see MARKDOWN.md).
 */
export interface VellumColumns {
  type: "columns";
  /** Directive attributes, e.g. `:::columns{gap=wide}`. */
  attributes: Record<string, string>;
  /** Each entry is one column's ordered node list. */
  columns: VellumNode[][];
}

/** A top-level document node: a kind block, a prose run, or a columns layout. */
export type VellumNode = VellumBlock | VellumProse | VellumColumns;

export interface VellumDocument {
  mode: ThemeMode;
  /** Ordered, heterogeneous content: prose, `:::kind` blocks, and columns. */
  nodes: VellumNode[];
}
