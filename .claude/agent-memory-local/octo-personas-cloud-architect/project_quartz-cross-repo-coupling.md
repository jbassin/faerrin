---
name: faerrin-quartz-cross-repo-coupling
description: pkg/quartz/scripts/config.ts hardcodes an absolute path into a SIBLING caster repo outside the monorepo (/ruby/data/experiments/caster), a latent coupling the migration must handle.
metadata:
  type: project
---

`pkg/quartz/scripts/config.ts` `podcast.episodesPath` defaults to
`/ruby/data/experiments/caster/site/dist/episodes.json` — an absolute path into a SIBLING `caster`
repo OUTSIDE the monorepo's `pkg/` (NOT `pkg/caster`). Overridable via `PODCAST_EPISODES_PATH` env;
missing file is silently skipped (no error).

**Why:** quartz's `export` step adds podcast deeplinks to Script pages from this external file. The
2026-06-03 migration discovery doc did not flag this cross-repo dependency.

**How to apply:** When migrating quartz or validating its build under the monorepo, this path still
resolves to the old sibling location, so podcast links may silently stop appearing (or keep pointing
outside the repo). Flag as an explicit decision: keep the env override, vendor episodes.json, or drop
the feature. See [[faerrin-monorepo]].
