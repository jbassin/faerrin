# CLAUDE.md — `content`

Guidance for **content**: the monorepo's **content platform** — the single source of truth for
shared campaign data (the wiki + transcripts) **and** the pipeline that generates it. See `README.md`
for the narrative overview; this file is the editing contract.

> **This is the SSOT.** The wiki and transcripts live here and **only** here. Other apps consume the
> *data* by filesystem path (cwd-relative `../content/...`), never as a package import — the one
> exception is aether's renderer importing `folderIndexName` from `scripts/lib/folder-index.ts`. Do
> not re-create per-app copies of `wiki/` or `transcripts/`.

## Data (the SSOT)

- **`wiki/`** — the hand-maintained Obsidian wiki (aether is canonical for content). Also holds the
  **generated** `wiki/Script/` transcript pages (written by the pipeline's `export` step). aether's
  Astro build reads `wiki/` as its content root; **heartwood and caster read `wiki/` but exclude
  `Script/`** (those are transcript pages, not wiki articles).
- **`transcripts/`** — canonical line-numbered session transcripts (`NNNNNN\t<text>`), generated from
  the pipeline's `scripts/script/*.txt` by `build:transcripts`. Consumed by heartwood + caster.

## Pipeline (`scripts/`)

```sh
bun run --filter @faerrin/content pipeline          # ingest → export → script (all)
bun run --filter @faerrin/content build:transcripts # regenerate transcripts/ from scripts/script
bun run --filter @faerrin/content review            # transcript-correction review UI
```

- **`scripts/run.ts`** — CLI orchestrator (`ingest` / `export` / `script` / all).
- **`scripts/pipeline/`** — `ingest.ts` (remote API → `scripts/data/*.json`), `export.ts`
  (→ `wiki/Script/*.md` directive pages + auto-linked wikilinks), `script.ts`
  (→ `scripts/script/*.txt`, `scripts/shibboleth.json`).
- **`scripts/lib/`** — `paths`, `content` walker, `corrections`, `linker`, `campaigns`, `roster`,
  `http` (retry), `log`, `types`, and the **shared** `folder-index.ts` (also imported by aether's
  renderer — keep it isomorphic and dependency-light).
- **`scripts/build-transcripts.ts`** — renders `scripts/script/*.txt` into the canonical
  line-numbered `transcripts/`.

## Config & generated artifacts

- **`scripts/campaigns.yaml`** — SSOT for player↔character mappings + campaign descriptions (used to
  build LLM context headers). `scripts/shibboleth.json` is a **generated** artifact derived from it by
  the `script` step — edit the YAML, not the JSON.
- **`scripts/defs.yaml`** — transcript corrections (regex fragments applied during `ingest`); the
  `review` UI appends to it.
- **`scripts/lib/roster.ts`** — the speaker roster (recording user ID → display name + color); the
  SSOT that wretch's `isPlayer` and the pipeline both use.
- **Generated, do not hand-edit:** `wiki/Script/**`, `scripts/data/*.json`, `scripts/script/*.txt`,
  `scripts/shibboleth.json`.

## Conventions

- Bun-first (`bun run`, `bunx tsx`); the pipeline runs via `tsx` (no build step). Paths derive from
  the package root at runtime — no hardcoded absolute paths.
- **Never `.split("content/")` on a path** — `"content/"` contains `"content/"`. Split on the
  real base (`"content/wiki/"`).
- Env: copy `.env.example` → `.env` here for the `ingest` source URLs/keys.
