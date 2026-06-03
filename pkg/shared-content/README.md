# shared-content

Single source of truth for campaign data shared across the monorepo's apps.

This is a **data directory** (not a code package you import) — consumers reference it by
filesystem path, derived from their own location. It carries a small `package.json` only so its
generators can run as workspace scripts.

## Contents

- `transcripts/` — canonical line-numbered session transcripts (`NNNNNN\t<text>`). **Generated**
  from quartz's pipeline output (`../quartz/scripts/script/*.txt`), which is the producer of record
  (it ingests from the remote API and applies corrections). Regenerate with:

  ```sh
  bun run --filter shared-content build:transcripts
  ```

  The generator (`scripts/build-transcripts.ts`) is header-length-agnostic (starts at the first
  quoted line), replacing the old `heartwood/update-transcripts.sh` (dead `/emerald/` paths + a
  fixed `tail -n +38` that only worked for one campaign).

## Consumers

- **heartwood** reads `../shared-content/transcripts/` (its pipeline: segment → … → submit).
- **caster** reads `../shared-content/transcripts/` (audio/TTS ingest).

> Paths are currently cwd-relative (`../shared-content/...`), matching how the apps are run from
> their own directories. If apps ever run from elsewhere, switch to repo-root-derived resolution.

## Roadmap

The wiki corpus (currently triplicated across quartz/heartwood/caster) is slated to join this SSOT
next, with quartz's `content/` as canonical (heartwood's copy is out of date).
