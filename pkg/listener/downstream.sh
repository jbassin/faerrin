#!/usr/bin/env bash
# Downstream cascade for the listener reconciler: publish freshly-transcribed
# sessions to the wiki and the podcast. Invoked by src/process.ts as
# `bash downstream.sh <date> [<date> ...]` after new transcripts are produced
# (only on materialization, so it never re-spends on idle ticks).
#
# Order matters: the wiki pipeline produces the canonical transcripts that caster
# reads, caster produces the episode, caster-site emits episodes.json, and the
# final quartz build picks up the podcast links. caster per-session steps are
# best-effort (a podcast hiccup must not block the wiki publish).
#
# Edit this to taste — it is your pipeline made explicit. Env knobs:
#   INGEST_SOURCE        (default local) — read transcripts off disk, not HTTP
#   CASTER_TTS_PROVIDER  (default edge)  — free MS Edge TTS; set =elevenlabs for paid
#   SKIP_PODCAST=1       — wiki only, skip caster entirely
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ROOT}"

export INGEST_SOURCE="${INGEST_SOURCE:-local}"
TTS_PROVIDER="${CASTER_TTS_PROVIDER:-edge}"
DATES=("$@")

log() { echo "[downstream] $*"; }

# 0. Deps present (bun is workspace-aware; --frozen-lockfile fails on a stale lock).
bun install --frozen-lockfile

# 1. Wiki content pipeline (ingest → export → script) reading local transcripts,
#    then the canonical line-numbered transcripts caster consumes.
log "wiki pipeline (INGEST_SOURCE=${INGEST_SOURCE})"
bun run --filter shared-content pipeline
bun run --filter shared-content build:transcripts

# 2. Podcast: for each new session, resolve its caster session-id from the
#    transcript filename (<id>.<arc>.<date>.txt) and run the caster stages.
if [[ "${SKIP_PODCAST:-0}" != "1" ]]; then
  for date in "${DATES[@]}"; do
    match="$(ls "pkg/shared-content/transcripts/"*."${date}.txt" 2>/dev/null | head -1)"
    if [[ -z "${match}" ]]; then
      log "no transcript for ${date} — skipping podcast (wiki still updated)"
      continue
    fi
    id="$(basename "${match}" .txt)"
    log "podcast for ${id} (tts=${TTS_PROVIDER})"
    # Each stage caches and skips on re-run; failures are non-fatal.
    bun run --filter caster distill "${id}" \
      && bun run --filter caster script "${id}" \
      && bun run --filter caster tts "${id}" --provider="${TTS_PROVIDER}" \
      && bun run --filter caster assemble "${id}" \
      || log "WARN: podcast cascade failed for ${id} — continuing"
  done

  # 3. Podcast site → dist/episodes.json (the map quartz reads for episode links).
  log "caster-site build"
  bun run --filter caster-site build || log "WARN: caster-site build failed"
fi

# 4. Build the live wiki (picks up new Script pages + any new podcast links).
#    Clear Astro's content-layer cache (kept in two places, not reliably
#    invalidated) before building, mirroring quartz/build.sh.
log "quartz build"
rm -rf pkg/quartz/.astro "${ROOT}/node_modules/.astro"
( cd pkg/quartz && bunx astro build )

log "done: ${DATES[*]}"
