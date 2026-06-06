#!/bin/bash
# Production build: content pipeline → Astro build → public/, which the reverse
# proxy serves. Astro lives at the repo root and emits straight into public/
# (its outDir), so there is no separate copy/rsync step.
set -x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Workspace root (monorepo): node_modules is hoisted there under bun workspaces.
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# 0. Install deps FIRST (so the pipeline's tsx + deps are present). bun is
# workspace-aware; --frozen-lockfile fails if the root bun.lock is stale.
bun install --frozen-lockfile

# 1. Content pipeline (ingest → export → script). It lives in pkg/content
# now (the content platform); it writes the wiki Script pages into content/wiki,
# which this site reads as its astro content root.
bun run --filter @faerrin/content pipeline

# 2. Clear the content-layer cache. Astro does NOT reliably invalidate it on
# remark-plugin edits or regenerated Script pages (which can otherwise ship a
# stale render or spam "Duplicate id … later items overwrite" warnings). The
# data store lives at Astro's cacheDir = <root>/node_modules/.astro — and under
# bun's per-package node_modules that resolves to THIS package's
# node_modules/.astro, NOT the hoisted ${ROOT}/node_modules/.astro. Clear all
# three (the project .astro/ for types, plus both node_modules/.astro locations
# so it stays correct whichever way bun hoists). `bun install` does NOT wipe
# node_modules, so we remove them explicitly.
rm -rf .astro node_modules/.astro "${ROOT}/node_modules/.astro"

# 3. Build the Astro site → public/ (astro-pagefind builds the search index in
# astro:build:done; Astro empties outDir each build so removed pages don't linger).
bunx astro build
