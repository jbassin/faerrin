// aether-faithful Markdown → HTML renderer for the review app (plan D-8,
// Phase 0a #3). Reuses aether's Obsidian transforms VERBATIM (callouts,
// transcript directives, directive→hast handlers) so the rendered proposal
// reads exactly as it will on heart.iridi.cc — the spec's "review rendered
// prose, not diffs" bar (AC-2). Wikilinks use an injected-allSlugs variant
// (see remark-wikilinks-injected.ts) instead of aether's module-load fs walk.
//
// Raw HTML (callout title markup, Timeline.md's hand-written HTML, <pre> flavor
// docs) is preserved via allowDangerousHtml on both remark-rehype and
// rehype-stringify — matching Astro's HTML-passthrough behavior.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype, { type Options as RemarkRehypeOptions } from "remark-rehype";
import remarkSmartypants from "remark-smartypants";
import rehypeStringify from "rehype-stringify";
// Cross-package reuse of aether's live renderer internals (plan: "reuse aether's
// remark-*.mjs"). Relative imports resolve by filesystem; the .mjs files' own
// bare imports resolve against pkg/aether/node_modules. They are untyped JS
// (allowJs), so the imported bindings are `any` — fine for plugin factories.
import remarkCallouts from "../../../aether/src/lib/remark-callouts.mjs";
import remarkTranscript from "../../../aether/src/lib/remark-transcript.mjs";
import { directiveHandlers } from "../../../aether/src/lib/directive-handlers.mjs";
import { remarkWikilinksInjected } from "./remark-wikilinks-injected.ts";
import { rehypeHeadingIds } from "./rehype-heading-ids.ts";

const rehypeOptions: RemarkRehypeOptions = {
  // directiveHandlers is from an untyped .mjs; its JS-inferred shape doesn't
  // line up with the strict Handlers type, but it is the exact handler set
  // aether ships. Reuse it verbatim.
  handlers: directiveHandlers as unknown as RemarkRehypeOptions["handlers"],
  allowDangerousHtml: true,
};

export interface RenderOptions {
  /** FullSlug of the page being rendered (the wikilink source). */
  srcSlug: string;
  /** Every known page slug, for "shortest" wikilink resolution. */
  allSlugs: string[];
}

/**
 * Render wiki Markdown to aether-faithful HTML.
 * @param md   the page body (frontmatter already stripped by the caller)
 */
export async function renderWikiMarkdown(
  md: string,
  opts: RenderOptions,
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    // callouts after remark-directive, before wikilinks (aether's order)
    .use(remarkCallouts)
    .use(remarkWikilinksInjected, {
      srcSlug: opts.srcSlug,
      allSlugs: opts.allSlugs,
    })
    .use(remarkTranscript)
    // smartypants matches Astro's `smartypants: true` (en/em dashes, smart quotes)
    .use(remarkSmartypants)
    .use(remarkRehype, rehypeOptions)
    // heading ids, matching Astro's default rehypeHeadingIds
    .use(rehypeHeadingIds)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(md);
  return String(file);
}
