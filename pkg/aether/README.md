# aether

The **Faerrin campaign wiki** renderer — an [Astro](https://astro.build) 5 + [Solid](https://www.solidjs.com)
static site, deployed at **[heart.iridi.cc](https://heart.iridi.cc)**. It renders the hand-maintained
Obsidian wiki (Pathfinder 2e setting lore + generated session-transcript pages) with wikilinks,
backlinks, a graph view, full-text search, and an interactive transcript player.

> This package is the **renderer only**. The wiki content is the single source of truth in
> [`pkg/content`](../content) (`wiki/`); aether reads `../content/wiki` as its
> Astro content root. To change content, edit `content`.

## Getting started

Requires [Bun](https://bun.sh) and [`just`](https://github.com/casey/just).

```bash
bun install
just dev            # Astro dev server → http://localhost:10114
just dev-search     # build + preview so Pagefind search works (it indexes built HTML)
```

## Commands

| Command                           | What it does                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `just dev`                        | Astro dev server at `localhost:10114` (search is empty in dev)                                                        |
| `just dev-search`                 | Build + preview so Pagefind search is exercised against a real build                                                  |
| `bun run check`                   | `astro check` + Prettier check                                                                                        |
| `bun run format`                  | Prettier write                                                                                                        |
| `bash build.sh` (or `just build`) | **Production build**: runs the `content` pipeline, clears Astro's content-layer cache, then `astro build` → `public/` |
| `bunx astro build`                | Build the site only (skip the content pipeline) → `public/`                                                           |
| `bunx astro preview`              | Serve the built site locally                                                                                          |

The content pipeline and the transcript-correction review UI live in `@faerrin/content`; `just pipeline`
and `just review` are convenience wrappers that run them from there.

## How it works

- **`astro.config.mjs`** wires the Solid + Pagefind integrations and the remark plugin chain
  (directive → callouts → wikilinks → transcript). `publicDir` is `assets/` (committed source static
  files); `outDir` is `public/`.
- **`src/content.config.ts`** loads the wiki from `../content/wiki` via a glob loader.
- **`src/lib/slug.ts`** is the single source of truth for URL slugs; **`src/lib/site.ts`** builds the
  link/backlink/breadcrumb/Explorer index at build time.
- **`src/components/islands/*.tsx`** are the Solid islands: Darkmode, Explorer, Graph, Popover,
  ReaderMode, Search, and the TranscriptPlayer (attached on `Script/` pages).

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture and editing conventions.

## Deployment

The production build emits to `public/`, served by a Caddy reverse proxy (`heart.iridi.cc →
aether/public`, configured in the repo-root `sites.caddyfile`). The output must stay byte-identical
across builds — don't change `outDir`/`publicDir`/`base`.
