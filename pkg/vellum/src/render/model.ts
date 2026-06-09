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
 * One parsed document block. `children` is the block's inner markdown content as
 * mdast nodes — the React layer renders it. The model is rules-illiterate: it
 * carries the author's text/attributes verbatim and never evaluates a number.
 */
export interface VellumBlock {
  kind: DocumentKind;
  /** Directive attributes, e.g. `:::statblock{level=5 rarity=unique}`. */
  attributes: Record<string, string>;
  /** Optional inline label from `:::statblock[Label]`. */
  label?: string;
  /** Inner content nodes (prose, lists, inline directives). */
  children: RootContent[];
}

export interface VellumDocument {
  mode: ThemeMode;
  blocks: VellumBlock[];
}
