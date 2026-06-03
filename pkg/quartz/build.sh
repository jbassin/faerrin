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

# 1. Content pipeline (ingest → export → script), via bun's native tsx runner.
bunx tsx scripts/run.ts all

# 2. Clear the content-layer cache. Astro keeps it in BOTH .astro/ and the
# hoisted ${ROOT}/node_modules/.astro/, and does NOT reliably invalidate it on
# remark-plugin edits (which can otherwise ship a stale render). Unlike `npm ci`,
# `bun install` does NOT wipe node_modules, so we remove both caches explicitly.
rm -rf .astro "${ROOT}/node_modules/.astro"

# 3. Build the Astro site → public/ (astro-pagefind builds the search index in
# astro:build:done; Astro empties outDir each build so removed pages don't linger).
bunx astro build
