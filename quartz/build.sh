#!/bin/bash
# Production build: content pipeline → Astro build → public/, which the reverse
# proxy serves. Astro lives at the repo root and emits straight into public/
# (its outDir), so there is no separate copy/rsync step.
set -x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Prod env: load node via nvm if present (no-op locally / in CI that already has node).
[ -f "${HOME}/.bashrc" ] && source "${HOME}/.bashrc"
command -v nvm >/dev/null 2>&1 && nvm use node

# 1. Content pipeline (ingest → export → script).
npx tsx scripts/run.ts all

# 2. Build the Astro site → public/ (astro-pagefind builds the search index in
# astro:build:done; Astro empties outDir each build so removed pages don't linger).
# Clear the content-layer cache first — Astro caches it in BOTH .astro/ and
# node_modules/.astro/ and does NOT reliably invalidate it on remark-plugin edits,
# which can otherwise ship a stale render. (npm ci wipes node_modules/.astro.)
rm -rf .astro
npm ci
npm run build
