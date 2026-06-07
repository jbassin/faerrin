# content

The monorepo's **content platform** — the single source of truth for shared campaign data
(wiki + transcripts) **and** the pipeline that generates it. Apps consume the *data* by filesystem
path; aether additionally imports one shared helper (`folderIndexName`).

## Data (the SSOT)

- `wiki/` — the hand-maintained Obsidian wiki (aether is canonical). Also holds the **generated**
  `wiki/Script/` transcript pages (written by the pipeline's `export` step). aether's astro build
  reads `wiki/` as its content root; caster reads `wiki/` for matching/cleaning and
  **excludes `Script/`** (those are transcript pages, not wiki articles).
- `transcripts/` — canonical line-numbered session transcripts (`NNNNNN\t<text>`), generated from
  the pipeline's `scripts/script/*.txt`. Consumed by caster.

## The pipeline (`scripts/`)

Moved here from aether (it was entangled with aether's renderer only via `slug.ts` —now back in
aether `src/lib/`— and the shared `folder-index.ts`, which stayed here). Run it:

```sh
bun run --filter @faerrin/content pipeline          # ingest → export → script (all)
bun run --filter @faerrin/content build:transcripts # regenerate transcripts/ from scripts/script
```

- `scripts/run.ts` — CLI orchestrator (`ingest`/`export`/`script`/`all`).
- `scripts/pipeline/` — `ingest.ts` (remote API → `scripts/data/*.json`), `export.ts`
  (→ `wiki/Script/*.md`), `script.ts` (→ `scripts/script/*.txt`, `scripts/shibboleth.json`).
- `scripts/lib/` — `paths`, `content` walker, `corrections`, `linker`, `campaigns`, `roster`,
  `http`, `log`, `types`, and the **shared** `folder-index.ts` (imported by aether's renderer too).
- `scripts/build-transcripts.ts` — header-agnostic line-numbered transcript generator (replaced an
  old broken `update-transcripts.sh`).
- `scripts/{campaigns.yaml,defs.yaml,shibboleth.json}` — pipeline config/artifacts.

## Consumers

- **aether** (renderer) — astro reads `wiki/`; imports `scripts/lib/folder-index.ts`; runs the
  pipeline via `build.sh` (`bun run --filter @faerrin/content pipeline`).
- **caster** — reads `../content/wiki/` (Script excluded) + `../content/transcripts/`.

> Data paths are cwd-relative (`../content/...`), matching how apps run from their own dirs;
> the pipeline derives its own paths from `import.meta.url` (location-independent).
