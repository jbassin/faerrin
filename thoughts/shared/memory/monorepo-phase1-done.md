---
name: monorepo-phase1-done
description: Phase 1 of the bun-workspaces monorepo migration is complete; Phase 2 (shared-data SSOT) is the remaining gated work
metadata: 
  node_type: memory
  type: project
  originSessionId: a41d7bcb-21c6-477e-98c0-11899c79da15
---

> **Historical note (2026-06-06):** the `heartwood` package was later deemed a failed experiment and
> removed from the repo (commit `e2cb11e`). The mentions of heartwood below are a point-in-time record
> of the migration as it stood; heartwood no longer exists in the workspace.

Phase 1 of the faerrin monorepo migration (foundation) is **done** as of 2026-06-03, on a stack of
jj commits above `swxqlsqu` (docs: discovery+plan): `lnxymxyq` (bun workspace foundation),
`mlxkxwkz` (heartwood test-type fixes), `rxkwtnut` (@anthropic-ai/sdk 0.39→0.100), `trsoootk`
(dep unification + phantom devDeps), `wtxxkprm` (GitHub Actions CI).

What's true now: root bun workspace (`workspaces: ["pkg/*","pkg/caster/site"]`), one root `bun.lock`,
quartz fully on bun (renamed `heart-of-hearts`→`quartz`), husky removed (jj has no git hooks),
unified dep versions. **typecheck + astro check + lint all green; all sites build (quartz
byte-identical to baseline).** There are **5 apps** (the often-missed 5th is `pkg/caster/site` =
`caster-site`, a nested Astro app).

Two phantom deps were exposed by hoisting and fixed (declare deps you import directly):
`@tanstack/router-generator@^1.167.13` (strider generate-routes) and `@eslint/js@^9` (strider eslint config).

**Still RED — 2 PRE-EXISTING caster test failures (NOT migration-caused, untriaged):**
`corpus.integration.test.ts` hard-codes wiki.pages.size=93 but corpus has 121 (data drift), and
"parses all transcript files" (same real-corpus drift). Both are **Phase-2 reconciliation** work.
(The 3rd, heartwood `## Content files` casing, was FIXED — commit `nmnyslyr` — it was a real
loadConventions bug: indexOf mismatch fed the whole CLAUDE.md to the propose LLM. heartwood now 396/396.)

**Open decisions / caveats:** CI platform assumed GitHub Actions (no git remote set — may be GitLab);
quartz Dockerfile migrated to oven/bun but flagged off-deploy-path; `tsconfig.base.json` exists but apps
not yet wired to it. **Phase 2 — IN PROGRESS.** Decisions: quartz is STRICTLY CORRECT (canonical) for both wiki &
transcripts; heartwood/caster copies are stale. **Transcript SSOT DONE** (commit `mnlrvpln`):
`pkg/shared-content/` (workspace member) holds 41 canonical line-numbered transcripts +
`scripts/build-transcripts.ts` (robust, header-agnostic generator from quartz/scripts/script);
heartwood + caster repointed to `../shared-content/transcripts`; deleted heartwood/transcripts,
caster/content/transcripts, and the broken update-transcripts.sh.
**Wiki SSOT DONE** (commit `lytmrnpp`): quartz's 121 wiki pages → `pkg/shared-content/wiki` (quartz
canonical; caster's identical + heartwood's stale copies deleted). quartz reads it (paths.ts /
content-paths.mjs / content.config base); Script pages generated into `shared-content/wiki/Script`;
heartwood + caster read it with a `Script/` exclusion (Script = quartz-only transcript pages). Gotcha
fixed: slug derivation used `.split("content/")` which breaks on "shared-**content**/" — changed to
`.split("shared-content/wiki/")` in `[...slug].astro` + `site.ts`. **Validated: quartz build byte-parity
(763 files); whole workspace GREEN (caster 135, heartwood 396, strider 128) — the 2 once-pre-existing
caster corpus failures are now RESOLVED.** NOTE: the Script-generation CODE (quartz export + scripts/lib)
stays in quartz (entangled with the astro renderer); only its OUTPUT moved — a full content-platform
extraction was deliberately deferred.

**`@faerrin/llm` DONE** (commit `owpkluxt`): new `pkg/faerrin-llm` (`@faerrin/llm`) with
`AnthropicClient` — `message()` (text+tool, flexible cached system blocks, usage; heartwood) +
`callTool()` (caster-compatible) + max-tokens/missing-tool guards; pricing moved from heartwood.
caster imports it (local client deleted); heartwood `complete()` keeps its API/Zod/cost-log but
delegates the SDK call to `message()`. All green (faerrin-llm 5, caster 132, heartwood 396, strider 128).

**Content-platform extraction DONE** (commit `rnvqtnks`): moved quartz's whole content pipeline
(`scripts/` run+pipeline+lib+config+data+script+yaml) → `pkg/shared-content/scripts/`. The two
renderer↔pipeline couplings were split: `slug.ts` (renderer-only) → quartz `src/lib/slug.ts`
(10 imports repointed); `folder-index.ts` (genuinely shared) stayed in shared-content, quartz's
renderer imports it from there (2 sites). Deps gray-matter/js-yaml/@types/js-yaml/tsx moved to
shared-content; github-slugger stayed in quartz (slug.ts uses it). build.sh/justfile run the pipeline
via `bun run --filter shared-content pipeline`. shared-content is now the content platform; quartz is
a pure renderer. Validated: quartz build byte-identical (763), all typecheck + tests green.

**MIGRATION COMPLETE (Phase 1 + Phase 2 + content-platform).** 6 workspace packages
(caster, caster-site, heartwood, quartz, strider, @faerrin/llm + shared-content data/pipeline pkg).
Final cleanup DONE (commit `nunnssou`): D6 resolved (episodesPath → in-repo pkg/caster/site build
output, env-overridable); quartz Dockerfile deleted (unused); caster/heartwood/faerrin-llm/
shared-content/strider now extend root `tsconfig.base.json` (quartz + caster-site stay on
astro/tsconfigs/strict). All typecheck + tests green. **No known loose ends remain.** See
`.claude/session-plan.md`, [[quartz-builds-on-bun]], [[octo-personas-not-llms]].
