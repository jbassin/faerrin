// Node-safe readers over the SSOT content tree (pkg/content). Server functions
// run under Node (see spike.ts), so these use node:fs exclusively — never Bun.*.
// Mirrors aether's content-paths.mjs slug walk, but Node-safe and on demand.
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { slugForPath } from "../render/remark-wikilinks-injected.ts";

/** Repo-relative content roots; dev server cwd is pkg/heartwood-review. */
export const CONTENT_ROOT = join(process.cwd(), "..", "content");
export const WIKI_DIR = join(CONTENT_ROOT, "wiki");
export const TRANSCRIPTS_DIR = join(CONTENT_ROOT, "transcripts");

/**
 * Resolve `rel` under `root` and refuse anything that escapes it (path-traversal
 * guard). Server-fn inputs (page paths, transcript names) are user-controllable, and
 * node:path.join happily resolves `..`, so every file reader funnels through this.
 */
export function within(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const rootResolved = resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
    throw new Error(`path escapes content root: ${rel}`);
  }
  return abs;
}

/** All content-relative markdown paths under wiki/, posix-separated, sorted. */
export async function listWikiMarkdownFiles(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
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
