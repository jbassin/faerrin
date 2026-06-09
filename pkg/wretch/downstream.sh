#!/usr/bin/env bash
# Downstream cascade for the wretch reconciler: publish freshly-transcribed
# sessions to the wiki and the podcast. Invoked by src/process.ts as
# `bash downstream.sh <date> [<date> ...]` after new transcripts are produced
# (only on materialization, so it never re-spends on idle ticks).
#
# Order matters: the wiki pipeline produces the canonical transcripts that caster
# reads, caster produces the episode, face emits episodes.json, and the
# final aether build picks up the podcast links. caster per-session steps are
# best-effort (a podcast hiccup must not block the wiki publish).
#
# Edit this to taste — it is your pipeline made explicit. Env knobs:
#   INGEST_SOURCE        (default local) — read transcripts off disk, not HTTP
#   CASTER_TTS_PROVIDER  (default elevenlabs) — paid ElevenLabs voices; set =edge for free MS Edge TTS, =mock for offline silent
#   SKIP_PODCAST=1       — wiki only, skip caster entirely
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${ROOT}"

export INGEST_SOURCE="${INGEST_SOURCE:-local}"
TTS_PROVIDER="${CASTER_TTS_PROVIDER:-elevenlabs}"
DATES=("$@")

log() { echo "[downstream] $*"; }

# 0. Deps present (bun is workspace-aware; --frozen-lockfile fails on a stale lock).
bun install --frozen-lockfile

# 1. Wiki content pipeline (ingest → export → script) reading local transcripts,
#    then the canonical line-numbered transcripts caster consumes.
log "wiki pipeline (INGEST_SOURCE=${INGEST_SOURCE})"
bun run --filter @faerrin/content pipeline
bun run --filter @faerrin/content build:transcripts

# 2. Podcast: for each new session, resolve its caster session-id from the
#    transcript filename (<id>.<arc>.<date>.txt) and run the caster stages.
if [[ "${SKIP_PODCAST:-0}" != "1" ]]; then
  for date in "${DATES[@]}"; do
    match="$(ls "pkg/content/transcripts/"*."${date}.txt" 2>/dev/null | head -1)"
    if [[ -z "${match}" ]]; then
      log "no transcript for ${date} — skipping podcast (wiki still updated)"
      continue
    fi
    id="$(basename "${match}" .txt)"
    log "podcast for ${id} (tts=${TTS_PROVIDER})"
    # Each stage caches and skips on re-run; failures are non-fatal.
    bun run --filter @faerrin/caster distill "${id}" \
      && bun run --filter @faerrin/caster script "${id}" \
      && bun run --filter @faerrin/caster tts "${id}" --provider="${TTS_PROVIDER}" \
      && bun run --filter @faerrin/caster assemble "${id}" \
      || log "WARN: podcast cascade failed for ${id} — continuing"
  done

  # 3. Podcast site → dist/episodes.json (the map aether reads for episode links).
  log "face build"
  bun run --filter @faerrin/face build || log "WARN: face build failed"
fi

# 4. Build the live wiki (picks up new Script pages + any new podcast links).
#    Clear Astro's content-layer cache (kept in two places, not reliably
#    invalidated) before building, mirroring aether/build.sh.
log "aether build"
rm -rf pkg/quartz/.astro "${ROOT}/node_modules/.astro"
( cd pkg/aether && bunx astro build )

log "done: ${DATES[*]}"
