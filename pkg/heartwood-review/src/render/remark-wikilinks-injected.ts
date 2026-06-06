// Wikilink resolver for the review app — the SAME algorithm as aether's
// `src/lib/remark-wikilinks.mjs` (transformLink, "shortest" strategy), but with
// `allSlugs` and the source slug INJECTED rather than computed from a module-load
// fs walk of content-paths.mjs (plan D-8 / Phase 0a #3). This lets the app supply
// a slug set that can include pending new-page proposals, and keeps the renderer
// pure. Slug logic is imported from aether so resolution stays byte-faithful.
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import {
  slugifyFilePath,
  transformLink,
  type FilePath,
  type FullSlug,
} from "./vendor/aether-slug.ts";

// [[fp]], [[fp|alias]], [[fp#anchor]], [[fp#anchor|alias]] (embeds skipped, as aether does)
// Kept byte-identical to aether's remark-wikilinks.mjs regex (the in-char-class
// escapes are redundant but match aether exactly — do not "simplify").
/* eslint-disable no-useless-escape -- the in-char-class escapes mirror aether's regex byte-for-byte; do not simplify */
const wikilinkRegex =
  /(!?)\[\[([^\[\]\|\#]+)?(#+[^\[\]\|\#]+)?(\|[^\[\]\#]+)?\]\]/g;
/* eslint-enable no-useless-escape */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface WikilinkOptions {
  /** The FullSlug of the page being rendered (the link source). */
  srcSlug: string;
  /** Every known page slug — drives the "shortest" resolution strategy. */
  allSlugs: string[];
}

/**
 * unified plugin. Mirrors aether's two-branch handling:
 *   - text nodes → proper mdast link nodes
 *   - html nodes → in-place string replacement (raw HTML stays raw)
 */
export function remarkWikilinksInjected(opts: WikilinkOptions) {
  const src = opts.srcSlug as FullSlug;
  const allSlugs = opts.allSlugs as FullSlug[];
  const resolve = (target: string) =>
    transformLink(src, target, { strategy: "shortest", allSlugs });

  return (tree: Root) => {
    // 1) raw HTML blocks/spans: string-replace in place (stays raw HTML).
    visit(tree, "html", (node) => {
      if (!node.value.includes("[[")) return;
      node.value = node.value.replace(
        wikilinkRegex,
        (
          whole: string,
          bang: string,
          fp: string | undefined,
          anchor: string | undefined,
          aliasRaw: string | undefined,
        ) => {
          if (bang === "!") return whole;
          if (!fp && !anchor) return whole;
          const target = (fp ?? "") + (anchor ?? "");
          const alias = aliasRaw ? aliasRaw.slice(1) : (fp ?? anchor ?? "");
          const url = resolve(target);
          return `<a href="${escapeHtml(url)}" class="internal">${escapeHtml(alias)}</a>`;
        },
      );
    });

    // 2) normal prose text nodes: emit proper mdast link nodes.
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index == null || !node.value.includes("[[")) return;
      const value = node.value;
      const children: unknown[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      wikilinkRegex.lastIndex = 0;
      while ((m = wikilinkRegex.exec(value)) !== null) {
        const [whole, bang, fp, anchor, aliasRaw] = m;
        if (bang === "!") continue; // skip embeds
        if (!fp && !anchor) continue;
        if (m.index > last)
          children.push({ type: "text", value: value.slice(last, m.index) });
        const target = (fp ?? "") + (anchor ?? "");
        const alias = aliasRaw ? aliasRaw.slice(1) : (fp ?? anchor ?? "");
        children.push({
          type: "link",
          url: resolve(target),
          data: { hProperties: { className: ["internal"] } },
          children: [{ type: "text", value: alias }],
        });
        last = m.index + whole.length;
      }
      if (children.length === 0) return;
      if (last < value.length)
        children.push({ type: "text", value: value.slice(last) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parent.children.splice(index, 1, ...(children as any));
      return index + children.length;
    });
  };
}

/** Helper: aether-faithful slug for a content-relative markdown path. */
export function slugForPath(contentRelPath: string): string {
  return slugifyFilePath(contentRelPath as FilePath);
}
