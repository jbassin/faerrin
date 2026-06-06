// Page-type detection for the page-type-aware voice bar (AC-24, §9). The wiki corpus
// is NOT uniformly literary prose — the §9 prose checks (encyclopedia-opener, intensifiers,
// "It is…") must be suppressed on stat blocks / HTML Timeline / <pre> flavor docs, which have
// their own structural shape. See the `wiki-nonprose-pages` memory + pkg/heartwood/CLAUDE.md.

export type PageType =
  | "lore" // literary prose — the §9 bar applies
  | "deity-statblock" // ` :: ` label/value lines
  | "timeline" // hand-authored HTML (Timeline.md)
  | "flavor-pre" // in-universe <pre> docs (logs, letters)
  | "stub"; // frontmatter-only placeholder — graduates to the prose bar on first paragraph

/** Page types that face the literary prose bar. A stub graduates to prose on its first paragraph. */
export const PROSE_PAGE_TYPES: ReadonlySet<PageType> = new Set(["lore", "stub"]);

const stripFrontmatter = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n?/, "");

export function detectPageType(path: string, body: string): PageType {
  const base = path.split("/").pop() ?? path;
  if (base === "Timeline.md") return "timeline";

  const content = stripFrontmatter(body).trim();
  if (content.length === 0) return "stub";

  if (/<pre[\s>]/i.test(content)) return "flavor-pre";

  // Deity stat blocks: multiple ` :: ` (space-colon-colon-space) label/value lines.
  const statLines = content.split("\n").filter((l) => / :: /.test(l)).length;
  if (statLines >= 2) return "deity-statblock";

  // Heavy hand-authored HTML lists (Timeline-like pages not named Timeline.md).
  const htmlTags = (content.match(/<(ul|li|div|br\s*\/?)>/gi) ?? []).length;
  const proseText = content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (htmlTags >= 4 && proseText.length < htmlTags * 20) return "timeline";

  if (content.length < 40) return "stub";
  return "lore";
}
