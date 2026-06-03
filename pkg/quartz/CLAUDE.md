# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

# NOTE: The site renders with **Astro + Solid islands**, an app that lives at the

# repo root (`astro.config.mjs` + `src/`). The vendored Quartz SSG has been removed

# (see "Rendering layer" below + docs/refactor-plan.md).

```bash
# Local Astro dev server (http://localhost:10114). Pagefind search is empty in
# dev (it indexes built HTML) — use `just dev-search` to test search.
just dev
just dev-search              # build + preview so Pagefind search works

# Type-check + prettier check (root; covers scripts/ + migration/)
npm run check

# Auto-format
npm run format

# Run tests
npm run test

# Full content pipeline + Astro build → publishes to public/ (what the reverse
# proxy serves). This is the production build.
bash build.sh                # or: just build

# Content pipeline (TypeScript, run via tsx)
npm run pipeline             # run all steps in order (ingest → export → script)
npm run pipeline ingest      # fetch transcripts from remote API → scripts/data/*.json
npm run pipeline export      # render transcript directive pages → content/Script/*.md
npm run pipeline script      # generate per-campaign LLM script files + shibboleth.json
# (equivalently: npx tsx scripts/run.ts [step], or `just pipeline [step]`)

# Transcript-correction review UI (http://localhost:10116)
npm run review               # or: just review

# Build the site only (skip content pipeline):
npx astro build              # → public/ (Astro's outDir; what the proxy serves)
npx astro preview            # serve the built site locally

# Migration parity gates (must stay green): slug, link-graph, full URL set
npx tsx migration/parity-slugs.ts
npx tsx migration/parity-graph.ts
npx tsx migration/parity-urls.ts
```

## Architecture

### Rendering layer — Astro + Solid islands (repo root) — ACTIVE

The site is rendered by an **Astro 5 app at the repo root** (the Quartz→Astro
rebuild; see `docs/refactor-plan.md`). `build.sh` runs the content pipeline then
`astro build`, which emits directly into `public/` (proxy-served) — there is no
separate copy step. Key files:

- **`astro.config.mjs`** — integrations (Solid, Pagefind) + the ported remark
  plugins (`src/lib/remark-{callouts,wikilinks,transcript}.mjs`). `publicDir` is
  `assets/` (committed source static files: favicon, og-image, icon); `outDir` is
  `public/`.
- **`src/layouts/PageLayout.astro`** — the grid shell + sidebar chrome.
- **`src/lib/site.ts`** — build-time index (resolved links/backlinks, git
  dates, breadcrumbs, Explorer tree) reusing the isomorphic **`src/lib/slug.ts`**
  (the single source of truth for URL slugs — ported verbatim from Quartz).
- **`src/components/islands/*.tsx`** — Solid islands (TranscriptPlayer,
  Darkmode, ReaderMode, Explorer, Search, Popover, Graph).
- **`migration/`** — the parity harness + frozen golden baseline. The three gates
  (slug/graph/url) must stay green.

The vendored Quartz SSG (`quartz/`, `quartz.config.ts`, `quartz.layout.ts`) has been
**removed** — the Astro app (`astro.config.mjs` + `src/`) is the sole renderer. See
`docs/refactor-plan.md` for the full Quartz→Astro migration history (parity harness,
island ports, cutover).

#### Astro config & layout entry points

- **`astro.config.mjs`** — integrations + remark plugin order (directive →
  callouts → wikilinks → transcript) + Shiki/markdown settings.
- **`src/layouts/PageLayout.astro`** — the grid shell, head, and sidebar chrome
  (which islands appear where). `src/content.config.ts` is the frontmatter (zod) schema.
- **`src/pages/`** — routes: `[...slug].astro` (content + folder + alias),
  `tags/[...tag].astro`, `index.xml.ts` (RSS), `sitemap.xml.ts`, `static/contentIndex.json.ts`
  (graph data), `404.astro`.

### Content pipeline — MOVED to `pkg/shared-content`

> The content pipeline (ingest → export → script) and its `lib/` now live in
> **`pkg/shared-content/scripts/`** (the monorepo content platform), not here. It writes the
> wiki Script pages into `shared-content/wiki/Script`, which this site reads as its astro content
> root. Run it via `bun run --filter shared-content pipeline` (or `just pipeline [step]`). The
> isomorphic URL-slug logic (`slug.ts`) stayed with the renderer at **`src/lib/slug.ts`**; the
> shared `folder-index.ts` lives in `shared-content/scripts/lib/`. The detail below is retained for
> reference but the code paths are now under `shared-content`.

### Content pipeline (historical — see shared-content)

This repo hosts a TTRPG campaign wiki for the _Faerrin_ setting. A custom TypeScript
pipeline (run with `tsx`, no build step) generates content from external sources before
the Astro build. The CLI entrypoint is **`scripts/run.ts`** (`npm run pipeline [step]`),
which dispatches to one module per step in `scripts/pipeline/`:

| Step (`scripts/pipeline/`) | Input                                                 | Output                                                                                                                          |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ingest.ts`                | `static-audio.iridi.cc` API (transcript JSON + audio) | `scripts/data/*.json`                                                                                                           |
| `export.ts`                | `scripts/data/*.json` + `campaigns.yaml`              | `content/Script/<campaign>/*.md` (per-campaign folders; unmatched → `Unsorted/`; transcript directives — see Transcript plugin) |
| `script.ts`                | `scripts/data/*.json` + `campaigns.yaml`              | `scripts/script/*.txt`, `scripts/shibboleth.json`                                                                               |

Shared logic lives in `scripts/lib/` (`paths`, `content` walker, `corrections`, `linker`,
`roster`, `campaigns`, `http` with retry, `log`, `types`). Operational config
(URLs, ports, thresholds) is centralized in
**`scripts/config.ts`**. Paths are derived from the repo root at runtime — there are no
hardcoded absolute paths.

**Campaign/character config** lives in **`scripts/campaigns.yaml`** (the source of truth for
player↔character mappings and campaign descriptions, used to generate LLM context headers).
`scripts/shibboleth.json` is a **generated artifact** derived from it by the `script` step.

**Speaker roster** (recording user ID → display name + color) lives in `scripts/lib/roster.ts`.

**Transcript corrections** in `scripts/defs.yaml` map mis-transcribed words/names to their
correct forms (regex fragments, applied during `ingest`). The `npm run review` UI appends to it.

**Auto-linking** (`scripts/lib/linker.ts`, used by `export`): scans all other content files and
replaces plain-text mentions of their titles/aliases with Obsidian-style wikilinks (`[[title|match]]`).

**Transcript rendering** is split across two subsystems: `export` emits semantic
directives (`:::transcript-line{…}` / `::transcript-audio{…}`) into `content/Script/*.md`,
and the **`remark-transcript`** plugin (`src/lib/remark-transcript.mjs`, wired in
`astro.config.mjs`) expands them into the line + audio markup at build time. The
interactive player is the **`TranscriptPlayer` Solid island**
(`src/components/islands/TranscriptPlayer.tsx`, attached on Script pages). Styles live in
`src/styles/custom.scss` (speaker colors reference the `--text<Name>` vars in
`src/styles/theme.scss`). `export` still runs the auto-linker so `[[wikilinks]]` are
present for `remark-wikilinks` to resolve.

### Generated files (do not edit manually)

- `content/Script/**/*.md` — generated by `export` (the whole `content/Script/` tree is wiped and rebuilt each run; sessions are foldered by campaign, unmatched into `Unsorted/`)
- `scripts/data/*.json` — generated by `ingest`
- `scripts/shibboleth.json` — generated by `script` (edit `campaigns.yaml` instead)
- `scripts/script/*.txt` — generated by the `script` step
