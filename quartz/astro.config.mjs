import { defineConfig } from "astro/config"
import solidJs from "@astrojs/solid-js"
import pagefind from "astro-pagefind"
import remarkDirective from "remark-directive"
import remarkCallouts from "./src/lib/remark-callouts.mjs"
import remarkTranscript from "./src/lib/remark-transcript.mjs"
import remarkWikilinks from "./src/lib/remark-wikilinks.mjs"
import { directiveHandlers } from "./src/lib/directive-handlers.mjs"

// Interactive Solid islands + Pagefind static search. MPA (no ClientRouter) —
// full page loads, so islands just run on mount and we avoid the SPA
// cleanup-leak class.
//
// Source static assets live in ./assets (publicDir); the build emits straight
// into ./public (outDir), which is what the reverse proxy serves — so there is
// no separate copy/rsync step. Markdown content lives in ./content (read by the
// content loader via node fs, a sibling of this config now that the app is at
// the repo root), and the shared slug resolver in ./scripts is imported directly.
export default defineConfig({
  site: "https://heart.iridi.cc",
  trailingSlash: "ignore",
  build: { format: "file" },
  publicDir: "./assets",
  outDir: "./public",
  integrations: [solidJs(), pagefind()],
  markdown: {
    // Order matters: parse directives → resolve wikilinks (incl. those inside
    // transcript line bodies) → expand transcript directives to markup.
    remarkPlugins: [remarkDirective, remarkCallouts, remarkWikilinks, remarkTranscript],
    // Astro drops containerDirective nodes in mdast->hast; force them via handlers.
    remarkRehype: { handlers: directiveHandlers },
    gfm: true,
    smartypants: true,
  },
})
