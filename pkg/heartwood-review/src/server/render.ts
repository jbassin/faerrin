import { createServerFn } from "@tanstack/react-start";
import { slugForPath } from "../render/remark-wikilinks-injected.ts";
import type { WeaveTarget } from "@faerrin/heartwood/src/state/review.ts";

// Static imports are client-safe (slugForPath is pure). The node:fs content readers and
// the heavy unified renderer are dynamic-imported inside handlers (server-only).

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
 * Render a wiki page to aether-faithful HTML for proposal review (AC-2). Server-side:
 * reads the SSOT page + computes the slug set, then runs the shared renderer.
 */
export const renderPagePreview = createServerFn({ method: "GET" })
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<PagePreview> => {
    const { loadAllSlugs, readWikiPage } = await import("./content.ts");
    const { renderWikiMarkdown } =
      await import("../render/renderWikiMarkdown.ts");
    const raw = await readWikiPage(data.path);
    const allSlugs = await loadAllSlugs();
    const html = await renderWikiMarkdown(stripFrontmatter(raw), {
      srcSlug: slugForPath(data.path),
      allSlugs,
    });
    return { path: data.path, title: titleFromPath(data.path), html };
  });

/**
 * Render arbitrary authored Markdown (the reviewer's in-progress prose) to aether-faithful
 * HTML, so edit-in-place shows a live in-voice preview (AC-2/AC-4). `srcPath` is the target
 * page (drives wikilink resolution); for a new page pass its intended content-relative path.
 */
export const renderMarkdown = createServerFn({ method: "POST" })
  .inputValidator((data: { md: string; srcPath: string }) => data)
  .handler(async ({ data }): Promise<string> => {
    const { loadAllSlugs } = await import("./content.ts");
    const { renderWikiMarkdown } =
      await import("../render/renderWikiMarkdown.ts");
    const allSlugs = await loadAllSlugs();
    return renderWikiMarkdown(data.md, {
      srcSlug: slugForPath(data.srcPath),
      allSlugs,
    });
  });

const stripFm = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n?/, "");

/**
 * Render an amend page with the authored prose woven IN PLACE at the chosen location and
 * highlighted (AC-12), so the reviewer judges seam/rhythm in true context. The authored
 * span is wrapped in <mark class="woven"> before weaving so it stands out in the render.
 */
export const renderWovenPreview = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { path: string; authoredText: string; weave?: WeaveTarget }) => data,
  )
  .handler(async ({ data }): Promise<string> => {
    const { loadAllSlugs, readWikiPage } = await import("./content.ts");
    const { renderWikiMarkdown } =
      await import("../render/renderWikiMarkdown.ts");
    const { applyWeave } = await import("./commit.ts");
    const body = stripFm(await readWikiPage(data.path));
    const marked = `<mark class="woven">${data.authoredText.trim()}</mark>`;
    const woven = applyWeave(body, marked, data.weave).body;
    const allSlugs = await loadAllSlugs();
    return renderWikiMarkdown(woven, {
      srcSlug: slugForPath(data.path),
      allSlugs,
    });
  });
