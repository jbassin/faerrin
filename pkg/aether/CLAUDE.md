# CLAUDE.md — `aether`

Guidance for the **aether** package: the campaign wiki renderer for the _Faerrin_ TTRPG setting
(`heart.iridi.cc`). It is an **Astro 5 + Solid-islands** app (`astro.config.mjs` + `src/`). It is the
**renderer only** — the content pipeline and the wiki/transcript data are the SSOT in
**`pkg/content`**; aether reads `../content/wiki` as its Astro content root.

> Bun-first, like the rest of the monorepo: use `bun`/`bunx`, not npm/npx/node. The package extends
> `astro/tsconfigs/strict` (see `tsconfig.json`).

## Commands

```bash
# Local Astro dev server (http://localhost:10114). Pagefind search is empty in
# dev (it indexes built HTML) — use `just dev-search` to test search.
just dev                      # = bunx astro dev --port 10114
just dev-search               # build + preview so Pagefind search works

# Type-check (astro check) + prettier check, and auto-format:
bun run check                 # = astro check && bunx prettier . --check
bun run format                # = bunx prettier . --write

# Full content pipeline + Astro build → public/ (what the reverse proxy serves).
# This is the production build.
bash build.sh                 # or: just build

# Build / preview the site only (skip the content pipeline):
bunx astro build              # → public/ (Astro's outDir; what the proxy serves)
bunx astro preview            # serve the built site locally
```

The content pipeline and the transcript-correction **review** UI live in `pkg/content` now.
The justfile has convenience wrappers that run them from there:

```bash
just pipeline [step]          # = (cd ../content && bunx tsx scripts/run.ts [step])
just review                   # = (cd ../content && bunx tsx scripts/review.ts)
# Or directly: bun run --filter @faerrin/content pipeline
```

There is **no `test` script** here — aether has no unit tests; correctness is the `astro check` +
prettier gates plus the byte-parity build check (see Gotchas in the root `CLAUDE.md`).

## Architecture — Astro + Solid islands

The site is rendered by the Astro app in this package. `build.sh` runs the `content` pipeline,
clears Astro's content-layer cache (kept in both `.astro/` and the hoisted `${ROOT}/node_modules/.astro/`,
not reliably invalidated on remark-plugin edits), then `astro build`, which emits directly into
`public/` (proxy-served) — there is **no** separate copy/rsync step. Key files:

- **`astro.config.mjs`** — integrations (Solid, `astro-pagefind`) + the ported remark plugin chain
  (directive → callouts → wikilinks → transcript), Shiki/markdown settings. `publicDir` is `assets/`
  (committed source static files: favicon, og-image, icon); `outDir` is `public/`.
- **`src/content.config.ts`** — the `docs` content collection. Its glob loader's `base` is
  **`../content/wiki`** (the SSOT wiki, including generated `Script/` pages); the loader uses
  the raw relative path as the entry ID to keep the Quartz-faithful slug logic working. The
  frontmatter schema is lenient (`title/tags/aliases/img`, everything optional, `.passthrough()`).
- **`src/lib/slug.ts`** — the isomorphic URL-slug logic, **the single source of truth for URL slugs**
  (ported verbatim from Quartz; `github-slugger` lives in this package because of it).
- **`src/lib/site.ts`** — build-time index (resolved links/backlinks, git dates, breadcrumbs,
  Explorer tree), reusing `slug.ts`.
- **`src/lib/remark-{callouts,wikilinks,transcript}.mjs`** + `directive-handlers.mjs` /
  `content-paths.mjs` — the remark layer wired in `astro.config.mjs`.
- **`src/layouts/PageLayout.astro`** — the grid shell, head, and sidebar chrome (which islands appear
  where).
- **`src/components/islands/*.tsx`** — Solid islands: `Darkmode`, `Explorer`, `Graph`, `Popover`,
  `ReaderMode`, `Search`, `TranscriptPlayer`.
- **`src/pages/`** — routes: `[...slug].astro` (content + folder + alias), `tags/[...tag].astro`,
  `index.xml.ts` (RSS), `sitemap.xml.ts`, `static/contentIndex.json.ts` (graph data), `404.astro`.

The vendored Quartz SSG and the Quartz→Astro migration scaffolding (the `aether/` SSG,
`migration/` parity harness, `docs/refactor-plan.md`) have all been **removed** — the Astro app
(`astro.config.mjs` + `src/`) is the sole renderer.

## Transcript rendering

Transcript rendering is split across two subsystems: the `content` pipeline's `export` step
emits semantic directives (`:::transcript-line{…}` / `::transcript-audio{…}`) into the wiki's
`Script/` pages, and the **`remark-transcript`** plugin (`src/lib/remark-transcript.mjs`) expands them
into line + audio markup at build time. The interactive player is the **`TranscriptPlayer` Solid
island** (`src/components/islands/TranscriptPlayer.tsx`, attached on Script pages). Styles live in
`src/styles/custom.scss` (speaker colors reference the `--text<Name>` vars in `src/styles/theme.scss`).

## Gotchas

- **This is a live site behind a Caddy reverse proxy** (`heart.iridi.cc` → `aether/public`). The build
  output must stay byte-identical — do **not** change `outDir`/`publicDir`/`base`. Validate big changes
  with a build + file-set diff. See the root `CLAUDE.md`.
- **Content is read, not owned, here.** The wiki and transcripts are the SSOT in `pkg/content`;
  never re-create per-app copies. aether reads `../content/wiki`. To change content or the
  pipeline, edit `content` (see its `CLAUDE.md`).
- **`Script/` pages are aether-only** transcript pages generated into `content/wiki/Script` by
  the pipeline; heartwood and caster exclude `Script/` when reading the wiki.
- **Never `.split("content/")` on a path** — `"content/"` contains `"content/"`. Split on the
  real base (`"content/wiki/"`).
