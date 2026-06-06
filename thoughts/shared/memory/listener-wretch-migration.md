---
name: listener-wretch-migration
description: listener_wretch (Python/whisperx transcript+audio producer) — migration plan into the monorepo + host facts
metadata: 
  node_type: memory
  type: project
  originSessionId: a9df4680-1390-4a02-a2d8-ab78d76357e5
---

`listener_wretch` (`/ruby/data/experiments/listener_wretch`, external to the repo, **no git history**)
is the upstream producer the monorepo consumes: Python + **whisperx (Whisper large-v3 + PyTorch +
ffmpeg)** turns Craig Discord `.zip` recordings into per-session `script.json` (pulled by
`shared-content/scripts/pipeline/ingest.ts`) and `audio.mp3` (served to quartz listeners). Seam is
**decoupled over HTTP** via `config.ts → remote.baseUrl = static-audio.iridi.cc`.

**Migration plan (2026-06-04):** `/octo:plan` → `.claude/session-plan.md` (+ intent contract).
Approach = **hybrid, staged**. Optimize for: kill host coupling, language uniformity, minimal risk to
live sites. Non-goals: re-transcribe history, commit audio/model to git, replace whisperx.

**Progress (2026-06-04, executed via /octo:embrace; commits on detached HEAD atop `5812876`):**
- ✅ **Phase 1** (`423fed45`) — vendored as `pkg/listener` (Bun workspace member); `python/consts.py`
  derives paths + `LISTENER_*` env overrides (no `/emerald` hardcoding); strict `.gitignore` for the
  36GB `data/`; local CLAUDE.md.
- ✅ **Phase 2** (`ffdc6697` + `0225385f`) — hybrid: `src/process.ts` TS orchestrator (watch, state via
  `data/state.json`, unzip, ffmpeg `amix` audio merge, SoundStack assemble, publish) around the lone
  Python step `python/transcribe.py` (whisperx, model once/batch). Roster SSOT: added `isPlayer()` to
  `shared-content/scripts/lib/roster.ts`; `src/roster.ts` re-exports it. `process` → TS, `process:py`
  = fallback. 16 listener bun tests; whole workspace green.
- ✅ **Phase 3 core** (`3061977d`) — `ingest` got a switchable source (`config.ingest.source`, env
  `INGEST_SOURCE`, default `remote`=unchanged). `source=local` reads `script.json` off listener's
  `saved/` dir (`INGEST_SAVED_DIR`), sharing the remote transform. **Parity gate PASSED:** local ingest
  vs the 81-session old saved store reproduced all 75 committed `data/*.json` byte-for-byte (0 diff).
- ✅ **Reconciler refactor** (`66e19321`) — `src/process.ts` is now a **level-triggered reconciler**:
  `reconcile()` dedups on `saved/{date}/script.json` existence (no `state.json` — disk is the ledger),
  outputs via atomic `.tmp`→rename, `transcribe.py` skips finished tracks (per-track resume saves
  hours), `unzip -t` readiness gate (robust on synced/FUSE drives), single-flight lock. Downstream
  rebuild left as a signal (Phase 4). 19 listener tests; smoke-validated (truncated zip rejected).
- 📋 **Scheduling design decided (brainstorm 2026-06-04, `/octo:brainstorm` Team mode):** the pipeline
  (Craig zip → transcribe ~hrs → caster → quartz) needs event-driven scheduling. Verdict: **don't buy a
  heavy orchestrator.** Make the one expensive node a reconciler (DONE above), then point a dumb trigger
  at it — **cron today** (repoint `30 2 * * *` at `bun run --filter listener process`), **systemd
  `.path` unit tomorrow** (fast tick) + keep cron as recovery heartbeat. Readiness = `unzip -t` +
  size-debounce. **Windmill** (Bun runtime, ships with Caddy) is the named graduation if a click-retry
  UI is ever wanted. Higher-ceiling alt to investigate: a Craig/Discord "recording ready" webhook
  (pull the zip yourself, stop watching a synced folder). Full brief in conversation history.
- ✅ **Phase 4 in-repo** (`03e42f02`) — `reconcile()` runs `downstream.sh` for materialized dates
  (INGEST_SOURCE=local, only on new sessions). `downstream.sh` = full cascade: wiki pipeline + quartz
  build, then caster podcast (resolves date→session-id from transcript filename `<id>.<arc>.<date>.txt`;
  **free edge TTS default**, distill/script cost Anthropic $). `deploy/` ships systemd `.path`+`.service`
  templates (oneshot, no start timeout, OOM-hardened) + `CUTOVER.md` runbook. Knobs:
  `LISTENER_SKIP_DOWNSTREAM`, `LISTENER_DOWNSTREAM_CMD`, `CASTER_TTS_PROVIDER`, `SKIP_PODCAST`.
- ⏳ **Host execution remaining (user-owned, see `pkg/listener/deploy/CUTOVER.md`):** real whisper
  validation run; install systemd units + `loginctl enable-linger`; repoint cron to
  `systemctl --user start listener-reconcile.service` + retire old listener/quartz crons; set
  `LISTENER_DATA_PATH=/ruby/.../listener_wretch/data`; audio reverse-proxy move; decommission old project.
- **The whole in-repo migration (Phases 1–4) is DONE and green.** Caster is per-session-id keyed (not
  date) and TTS-defaults-to-ElevenLabs-paid — that's why the podcast cascade lives in editable
  `downstream.sh`, not hard-coded.
- Decisions locked: audio safe to move (user updates reverse proxy out-of-band); lowercase transcript
  regression accepted for now.
- **VCS:** 4 commits on jj bookmark `listener-migration` (local, detached HEAD, NOT pushed). Whole
  workspace green throughout (6 typecheck; listener adds 16 tests). See [[monorepo-phase1-done]].

**Phase 0 host facts (confirmed 2026-06-04):**
- `/emerald` is a **symlink → `/ruby`** (so `consts.py`'s `/emerald` paths = same disk; still hardcoded).
- Host has ffmpeg 4.4.2, uv 0.11.19, python 3.11. Cron: `30 2 * * *` `process.sh` (daily).
- Footprint **36GB**: model 2.9GB, `data/saved/` **27GB / 82 sessions** → gitignore `data/` is mandatory.
- Roster duplicated: `consts.PLAYERS` ↔ `shared-content/lib/roster.ts userToName` — unify to one SSOT.

**Open items:**
- `static-audio.iridi.cc` host is **unidentified** (not in `sites.caddyfile`, not in `/etc/{caddy,nginx}`) —
  must find what serves the 27GB before the Phase-3 audio-hosting decision.
- **Pre-existing regression:** transcripts went **lowercase/unpunctuated as of ~2026-6-1** (committed
  ≤2026-5-21 are capitalized). Verified the ingest transform is byte-faithful, so this is an upstream
  whisperx model/config change in listener_wretch, not migration-caused. Decide: restore casing or accept.
- Separate `12 * * * *` cron builds the OLD standalone `/emerald/.../quartz`, not monorepo `pkg/quartz` —
  live quartz deploy may still be pre-monorepo (deployment-cutover concern). See [[monorepo-phase1-done]].
