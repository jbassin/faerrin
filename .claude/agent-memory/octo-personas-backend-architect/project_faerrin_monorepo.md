---
name: project-faerrin-monorepo
description: Faerrin repo is consolidating 4 standalone apps under pkg/ into a single Bun-workspaces monorepo
metadata:
  type: project
---

The repo at `/ruby/data/experiments/faerrin` holds 4 previously-independent apps under `pkg/`:
caster, heartwood, quartz (package name **heart-of-hearts**), strider. Decision already made
to standardize on **Bun workspaces**.

Per-app toolchain (as of 2026-06-03):
- caster: bun CLI (TTS pipeline), `@anthropic-ai/sdk`, bun.lock. Bun-native tsconfig.
- heartwood: bun CLI (transcript→wiki MR pipeline), commander+zod, bun.lock. Bun-native tsconfig (identical to caster's).
- quartz/heart-of-hearts: **the lone npm holdout** — Astro 5 + Solid + tsx + pixi.js, package-lock.json,
  `.npmrc` engine-strict, `engines.npm>=10.9.2`, justfile + build.sh + Dockerfile all calling npx/npm.
  Astro refactor (Quartz SSG → Astro) is already complete.
- strider: bun + Vite 8 + TanStack Start + React 19 + pixi.js, husky/playwright/eslint, bun.lock.

**Why:** unify 4 repos into one workspace for shared tooling/lockfile.
**How to apply:** quartz is the migration's critical path (npm→bun). Its tsconfig has a stale
comment referencing a non-existent `tsconfig.scripts.json`. Naming mismatch: dir `quartz` vs
package `heart-of-hearts`. See [[reference-jj-repo]].
