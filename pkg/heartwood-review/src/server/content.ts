// Node-safe readers over the SSOT content tree (pkg/content). SERVER-ONLY: this module
// statically imports node:fs, so it must never be statically imported by a client
// component — server functions dynamic-import it inside their handlers. Pure path helpers
// (constants + within) live in paths.ts.
import { readFile, readdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import { slugForPath } from "../render/remark-wikilinks-injected.ts";
import { WIKI_DIR, within } from "./paths.ts";

/** All content-relative markdown paths under wiki/, posix-separated, sorted. */
export async function listWikiMarkdownFiles(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(relative(WIKI_DIR, full).split(sep).join("/"));
      }
    }
  }
  await walk(WIKI_DIR);
  return out.sort();
}

/** aether-faithful FullSlug set for "shortest" wikilink resolution. */
export async function loadAllSlugs(): Promise<string[]> {
  const files = await listWikiMarkdownFiles();
  return files.map((f) => slugForPath(f));
}

/** Read a wiki page's raw text (frontmatter included). Path-contained to WIKI_DIR. */
export async function readWikiPage(contentRelPath: string): Promise<string> {
  return readFile(within(WIKI_DIR, contentRelPath), "utf8");
}
