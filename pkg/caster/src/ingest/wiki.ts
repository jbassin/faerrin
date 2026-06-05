import type { WikiCorpus, WikiPage } from "../types.ts";
import { basename } from "node:path";

/** [[Target]] or [[Target|Alias]] — we keep Target, drop the alias. */
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/** YAML frontmatter delimited by leading `---` ... `---`. */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** A `title: ...` line inside frontmatter. */
const TITLE_RE = /^title:\s*(.+?)\s*$/m;

export interface CleanedWiki {
  title: string;
  text: string;
  links: string[];
}

/**
 * Clean one wiki markdown document:
 *  - split off YAML frontmatter (and read its `title` if present),
 *  - strip embedded HTML tags (the <pre>/<ul> flavor blocks),
 *  - collect outgoing [[wikilink]] targets (alias dropped, deduped, in order).
 *
 * `relPath` (path relative to content/wiki) is used to derive a fallback title.
 */
export function cleanWiki(raw: string, relPath: string): CleanedWiki {
  let body = raw;
  let title: string | undefined;

  const fm = FRONTMATTER_RE.exec(body);
  if (fm) {
    const titleMatch = TITLE_RE.exec(fm[1] ?? "");
    if (titleMatch) title = titleMatch[1];
    body = body.slice(fm[0].length);
  }

  // Collect wikilinks from the body before we touch anything else.
  const links: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(WIKILINK_RE)) {
    const target = (m[1] ?? "").trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      links.push(target);
    }
  }

  // Strip HTML tags and HTML comments; collapse the whitespace they leave behind.
  const text = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: title ?? titleFromPath(relPath), text, links };
}

/** Fallback title: the filename without extension (or its parent dir for index.md). */
export function titleFromPath(relPath: string): string {
  const name = basename(relPath).replace(/\.md$/, "");
  if (name === "index") {
    const parts = relPath.split("/");
    return parts.length >= 2 ? (parts[parts.length - 2] ?? name) : name;
  }
  return name;
}

/**
 * Resolve a wikilink target to a page path in the corpus.
 *
 * Obsidian-style links are loose: `[[Wrenford]]`, `[[Geography/Calaria/index]]`,
 * `[[Green Father]]`. We resolve by, in order: exact relative path (with/without
 * .md), then by basename-without-extension, then by page title. Unresolvable
 * links are dropped from the graph (kept on the page's `links` for debugging).
 */
function resolveLink(
  target: string,
  byPath: Map<string, WikiPage>,
  byBasename: Map<string, string>,
  byTitle: Map<string, string>,
): string | undefined {
  const withMd = target.endsWith(".md") ? target : `${target}.md`;
  if (byPath.has(withMd)) return withMd;
  if (byPath.has(target)) return target;

  const base = basename(target).replace(/\.md$/, "");
  if (byBasename.has(base)) return byBasename.get(base);
  if (byTitle.has(target)) return byTitle.get(target);

  return undefined;
}

/** Build the wiki corpus (cleaned pages + resolved link graph) from cleaned pages. */
export function buildCorpus(pages: WikiPage[]): WikiCorpus {
  const byPath = new Map<string, WikiPage>();
  const byBasename = new Map<string, string>();
  const byTitle = new Map<string, string>();

  for (const page of pages) {
    byPath.set(page.path, page);
    const base = basename(page.path).replace(/\.md$/, "");
    // First writer wins for ambiguous basenames (many "index.md"); path/title still resolve those.
    if (!byBasename.has(base)) byBasename.set(base, page.path);
    if (!byTitle.has(page.title)) byTitle.set(page.title, page.path);
  }

  const graph = new Map<string, string[]>();
  for (const page of pages) {
    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const link of page.links) {
      const dest = resolveLink(link, byPath, byBasename, byTitle);
      if (dest && dest !== page.path && !seen.has(dest)) {
        seen.add(dest);
        resolved.push(dest);
      }
    }
    graph.set(page.path, resolved);
  }

  return { pages: byPath, graph };
}

/** Load and clean every markdown file under `wikiDir` into a corpus. */
export async function loadWiki(wikiDir: string): Promise<WikiCorpus> {
  const glob = new Bun.Glob("**/*.md");
  const pages: WikiPage[] = [];

  for await (const rel of glob.scan({ cwd: wikiDir })) {
    // Script/ holds aether-generated transcript pages, not wiki articles.
    if (rel.startsWith("Script/")) continue;
    const raw = await Bun.file(`${wikiDir}/${rel}`).text();
    const cleaned = cleanWiki(raw, rel);
    pages.push({ path: rel, title: cleaned.title, text: cleaned.text, links: cleaned.links });
  }

  return buildCorpus(pages);
}
