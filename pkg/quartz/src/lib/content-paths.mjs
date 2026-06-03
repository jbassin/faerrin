// Shared list of content files + their Quartz-faithful slugs, computed once by
// reading ../../content. Used by the content loader (for IDs) and the wikilink
// resolver (for the `allSlugs` set that drives "shortest" resolution).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { slugifyFilePath } from "../../scripts/lib/slug.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
export const contentDir = path.resolve(here, "../../../shared-content/wiki")

/** All content-relative markdown file paths (posix separators). */
export function listMarkdownFiles() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue
        walk(full)
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(path.relative(contentDir, full).split(path.sep).join("/"))
      }
    }
  }
  walk(contentDir)
  return out.sort()
}

/** Map of content-relative file path -> Quartz FullSlug. */
export function buildSlugMap() {
  const map = new Map()
  for (const file of listMarkdownFiles()) {
    map.set(file, slugifyFilePath(file))
  }
  return map
}

export const slugMap = buildSlugMap()
export const allSlugs = [...slugMap.values()]
