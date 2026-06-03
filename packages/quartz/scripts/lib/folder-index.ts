/**
 * Folder-index naming: a folder index page (`.../Foo/index.md`) inherits its
 * title and an implicit alias from its parent directory name, so the directory
 * name need not be duplicated in every index.md's frontmatter.
 *
 * Single source of truth shared by every consumer that derives title/aliases
 * from a content path: the build-time site index (`src/lib/site.ts`), the alias
 * redirect emitter (`src/pages/[...slug].astro`), and the auto-linker
 * (`scripts/lib/content.ts`).
 *
 * @param rel content-relative path with extension, e.g. "Divinity/index.md".
 * @returns the parent directory name (e.g. "Divinity"), or null for non-index
 *   pages and for the root `content/index.md` (which has no parent folder).
 */
export function folderIndexName(rel: string): string | null {
  const parts = rel.split("/")
  if (parts[parts.length - 1] !== "index.md") return null
  if (parts.length < 2) return null // root content/index.md — no parent folder
  return parts[parts.length - 2]
}
