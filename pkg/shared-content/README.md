# shared-content

The monorepo's **content platform** — the single source of truth for shared campaign data
(wiki + transcripts) **and** the pipeline that generates it. Apps consume the *data* by filesystem
path; quartz additionally imports one shared helper (`folderIndexName`).

## Data (the SSOT)

- `wiki/` — the hand-maintained Obsidian wiki (quartz is canonical). Also holds the **generated**
  `wiki/Script/` transcript pages (written by the pipeline's `export` step). quartz's astro build
  reads `wiki/` as its content root; heartwood + caster read `wiki/` for matching/cleaning and
  **exclude `Script/`** (those are transcript pages, not wiki articles).
- `transcripts/` — canonical line-numbered session transcripts (`NNNNNN\t<text>`), generated from
  the pipeline's `scripts/script/*.txt`. Consumed by heartwood + caster.

## The pipeline (`scripts/`)

Moved here from quartz (it was entangled with quartz's renderer only via `slug.ts` —now back in
quartz `src/lib/`— and the shared `folder-index.ts`, which stayed here). Run it:

```sh
bun run --filter shared-content pipeline          # ingest → export → script (all)
bun run --filter shared-content build:transcripts # regenerate transcripts/ from scripts/script
```

- `scripts/run.ts` — CLI orchestrator (`ingest`/`export`/`script`/`all`).
- `scripts/pipeline/` — `ingest.ts` (remote API → `scripts/data/*.json`), `export.ts`
  (→ `wiki/Script/*.md`), `script.ts` (→ `scripts/script/*.txt`, `scripts/shibboleth.json`).
- `scripts/lib/` — `paths`, `content` walker, `corrections`, `linker`, `campaigns`, `roster`,
  `http`, `log`, `types`, and the **shared** `folder-index.ts` (imported by quartz's renderer too).
- `scripts/build-transcripts.ts` — header-agnostic line-numbered transcript generator (replaced the
  old broken `heartwood/update-transcripts.sh`).
- `scripts/{campaigns.yaml,defs.yaml,shibboleth.json}` — pipeline config/artifacts.

## Consumers

- **quartz** (renderer) — astro reads `wiki/`; imports `scripts/lib/folder-index.ts`; runs the
  pipeline via `build.sh` (`bun run --filter shared-content pipeline`).
- **heartwood** — reads `../shared-content/wiki/` (Script excluded) + `../shared-content/transcripts/`.
- **caster** — reads `../shared-content/wiki/` (Script excluded) + `../shared-content/transcripts/`.

> Data paths are cwd-relative (`../shared-content/...`), matching how apps run from their own dirs;
> the pipeline derives its own paths from `import.meta.url` (location-independent).
