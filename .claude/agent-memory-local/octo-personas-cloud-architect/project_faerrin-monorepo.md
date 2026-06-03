---
name: faerrin-monorepo
description: The faerrin repo is a jj-backed Bun-workspaces monorepo migration of 4 TTRPG apps under pkg/, with two LIVE static sites served by an external reverse proxy not in the repo.
metadata:
  type: project
---

`/ruby/data/experiments/faerrin` is a jj-colocated repo (`.jj/` + `.git/`) migrating four
independently-developed Pathfinder-2e "Faerrin" campaign apps into one Bun-workspaces monorepo:
- `pkg/caster` — Bun CLI, TTS/podcast pipeline, `@anthropic-ai/sdk@^0.100`
- `pkg/heartwood` — Bun CLI, transcript→wiki-edit pipeline (GitLab MRs), `@anthropic-ai/sdk@^0.39`
- `pkg/quartz` — pkg name `heart-of-hearts`, **npm/tsx** (the only non-bun app), Astro 5 + Solid, outputs to `public/` (served at heart.iridi.cc)
- `pkg/strider` — Bun, TanStack Start + Vite 8 + React 19, outputs to `dist/client/`

**Why:** apps share triplicated campaign data (wiki, transcripts) that is drifting; goal is a single
source of truth + shared deps. Plan is foundation-first: phase 1 = workspace/build/deploy plumbing,
phase 2 (gated) = shared-content SSOT + `@faerrin/llm` extraction.

**How to apply:**
- Both sites are LIVE and served by an EXTERNAL reverse proxy NOT in the repo. NEVER change
  outDir/basepath/asset-prefix without explicit user confirmation — this is the highest-stakes risk.
- All VCS ops use jj, never raw git (see [[faerrin-quartz-cross-repo-coupling]]).
- Planning docs live in `.claude/session-plan.md`, `.claude/session-intent.md`, and
  `thoughts/shared/research/2026-06-03-monorepo-migration-discovery.md`.
- quartz-on-bun (Astro5+Vite+Pagefind+Playwright OG render) is the unproven critical path.
