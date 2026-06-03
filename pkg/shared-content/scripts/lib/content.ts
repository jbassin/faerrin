import fs from "node:fs/promises"
import path from "node:path"
import matter from "gray-matter"
import { contentDir } from "./paths"
import { folderIndexName } from "./folder-index"
import type { ContentDoc } from "./types"

/**
 * Walk content/, parse frontmatter, and derive title/names/slug for each
 * markdown file.
 *
 * Files are returned in fs.readdir order with the exact filter sequence the
 * original scripts used, so generated output stays byte-identical.
 */
export async function walkContent(): Promise<ContentDoc[]> {
  const entries = await fs.readdir(contentDir, { recursive: true })
  const files = entries
    .filter((x) => !x.startsWith("Script"))
    .filter((x) => !x.startsWith("."))
    .filter((x) => x !== "Timeline.md")
    .filter((x) => x.endsWith(".md"))

  const docs: ContentDoc[] = []
  for (const file of files) {
    const raw = await fs.readFile(path.join(contentDir, file), { encoding: "utf8" })
    const { data, content } = matter(raw)
    const fm = data as Record<string, unknown>

    const filename = path.basename(file, ".md")
    let title = ""
    const names: string[] = []

    if (filename !== "index") {
      names.push(filename)
      title = filename
    } else {
      // Folder index pages take their parent directory name as title + a link
      // name, so the auto-linker still resolves [[Directory]] mentions and the
      // dirSlug stays well-formed without that name being spelled out in the
      // index.md frontmatter. (null for the root content/index.md.)
      const folderName = folderIndexName(file)
      if (folderName) {
        names.push(folderName)
        title = folderName
      }
    }
    if (fm.title !== undefined) {
      names.push(String(fm.title))
      title = String(fm.title)
    }
    if (Array.isArray(fm.aliases)) {
      names.push(...fm.aliases.map(String))
    }

    const dirSlug = file
      .replace(".md", "")
      .replace("index", title)
      .replaceAll(" ", "_")
      .toLowerCase()

    docs.push({
      file,
      data: fm,
      content,
      filename,
      title,
      names: [...new Set(names)],
      dirSlug,
    })
  }

  return docs
}
