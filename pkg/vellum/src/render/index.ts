/**
 * @faerrin/vellum renderer library. Pure parse pipeline + presentational React
 * components. Knows layout; never knows PF2e rules (R-9) or theme colors (those
 * come from injected @faerrin/gothic tokens).
 */
export { parseDocument, parseMarkdown } from "./parse.ts";
export { desugar } from "./surface.ts";
export { compileVss } from "./vss.ts";
export { canonicalToVss, vssToCanonical } from "./format.ts";
export {
  DOCUMENT_KINDS,
  DEFAULT_MODE_BY_KIND,
  type DocumentKind,
  type ThemeMode,
  type VellumBlock,
  type VellumProse,
  type VellumColumns,
  type VellumNode,
  type VellumDocument,
} from "./model.ts";
export { DocumentView } from "./components/DocumentView.tsx";
export { StatCard } from "./components/StatCard.tsx";
export { ProseCard } from "./components/ProseCard.tsx";
export { TraitPill } from "./components/TraitPill.tsx";
export { Redaction } from "./components/Redaction.tsx";
export { ErrorChip } from "./components/ErrorChip.tsx";
export {
  ActionGlyph,
  normalizeActionCost,
  type ActionCost,
} from "./glyphs/actions.tsx";
export { renderNodes, collectText } from "./mdastToReact.tsx";
