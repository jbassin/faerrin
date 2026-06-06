---
name: quartz-builds-on-bun
description: Spike proved quartz (Astro 5 + Vite + Pagefind) builds on bun with byte-for-byte output parity vs npm
metadata: 
  node_type: memory
  type: project
  originSessionId: a41d7bcb-21c6-477e-98c0-11899c79da15
---

On 2026-06-03 a disposable jj spike proved the riskiest part of the monorepo migration: **quartz
(`pkg/quartz`, Astro 5 + Solid + Vite + astro-pagefind) builds correctly under bun.**

Evidence: `bun install` migrated `package-lock.json` → `bun.lock` with no resolution errors
(bun ignores quartz's `.npmrc engine-strict` + `engines.npm`); `bunx astro build` ran the
`astro-pagefind` `astro:build:done` hook (346 pages indexed); the resulting `public/` was
**byte-for-byte identical to the npm-built baseline (763 files, 384 pagefind files, 0 diffs)**;
`bunx tsx scripts/run.ts export` ran the content pipeline under bun.

**Why:** discovery flagged Astro5+Vite+Pagefind-on-bun as the least-validated combo and the
migration's highest risk; this de-risks committing the repo to an all-bun workspace.

**How to apply:** don't re-run the spike. Proceed with the bun-workspace migration (see
[[octo-personas-not-llms]] for the persona-agent rule). Note the on-disk caveat: the spike left
`pkg/quartz/node_modules` bun-resolved; `tsx` still works via `bunx tsx` (plan keeps tsx for now).
Full plan: `.claude/session-plan.md` (v2); discovery: `thoughts/shared/research/2026-06-03-monorepo-migration-discovery.md`.
