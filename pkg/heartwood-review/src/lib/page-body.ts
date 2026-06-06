// Pure, client-safe helpers for editing a whole wiki page (no node:*). The amend flow populates
// the editor with the existing page body and the reviewer edits it directly; on commit the edited
// text REPLACES the page body while the original frontmatter (aliases, etc.) is preserved verbatim.

/** Split a raw page file into its leading `---`frontmatter`---` block (if any) and the body after. */
export function splitFrontmatter(raw: string): {
  frontmatter: string;
  body: string;
} {
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[0], body: raw.slice(m[0].length) };
}

/**
 * Produce the new full page file: keep `existing`'s frontmatter, replace the body with `newBody`.
 * Used on commit so a reviewer editing the populated page text never clobbers frontmatter.
 */
export function replacePageBody(existing: string, newBody: string): string {
  const { frontmatter } = splitFrontmatter(existing);
  const body = `${newBody.replace(/\s+$/, "")}\n`;
  return frontmatter ? `${frontmatter.replace(/\n*$/, "\n")}${body}` : body;
}
