import { createServerFn } from "@tanstack/react-start";
import { renderWikiMarkdown } from "../render/renderWikiMarkdown.ts";
import { slugForPath } from "../render/remark-wikilinks-injected.ts";
import { loadAllSlugs, readWikiPage } from "./content.ts";

export interface PagePreview {
  path: string;
  title: string;
  html: string;
}

const stripFrontmatter = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n?/, "");

function titleFromPath(contentRelPath: string): string {
  const base = contentRelPath.replace(/\.md$/, "");
  const parts = base.split("/");
  const last = parts.at(-1);
  return last === "index" ? (parts.at(-2) ?? base) : (last ?? base);
}

/**
 * Render a wiki page to aether-faithful HTML for the Phase-0a fidelity check
 * (and the basis of proposal rendering in Stage E). Server-side: reads the SSOT
 * page + computes the slug set, then runs the shared renderer.
 */
export const renderPagePreview = createServerFn({ method: "GET" })
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<PagePreview> => {
    const raw = await readWikiPage(data.path);
    const allSlugs = await loadAllSlugs();
    const html = await renderWikiMarkdown(stripFrontmatter(raw), {
      srcSlug: slugForPath(data.path),
      allSlugs,
    });
    return { path: data.path, title: titleFromPath(data.path), html };
  });

/**
 * Render arbitrary authored Markdown (the reviewer's in-progress prose) to
 * aether-faithful HTML, so edit-in-place shows a live in-voice preview (AC-2/AC-4).
 * `srcPath` is the page the prose targets (drives wikilink resolution); for a new
 * page pass its intended content-relative path.
 */
export const renderMarkdown = createServerFn({ method: "POST" })
  .inputValidator((data: { md: string; srcPath: string }) => data)
  .handler(async ({ data }): Promise<string> => {
    const allSlugs = await loadAllSlugs();
    return renderWikiMarkdown(data.md, {
      srcSlug: slugForPath(data.srcPath),
      allSlugs,
    });
  });
