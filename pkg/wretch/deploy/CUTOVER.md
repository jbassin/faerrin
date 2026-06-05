# Listener — Phase 4 cutover runbook

Take the migrated pipeline live: event-driven reconciler (systemd `.path`) + cron
recovery heartbeat, replacing the old polling cron and manual hand-offs. All host
steps — run them yourself; nothing here is done automatically.

The reconciler is `bun run --filter listener process` → `reconcile()`: it transcribes
any landed-but-unprocessed Craig zip, then runs `downstream.sh` (wiki + podcast).

## 0. Prerequisites (host)

- `bun`, `uv`, `ffmpeg`, `unzip` on PATH (all confirmed present).
- `ANTHROPIC_API_KEY` available to the service (caster distill/script). Put it in
  `~/.config/faerrin/listener.env` and uncomment `EnvironmentFile=` in the unit —
  keep it out of git.
- Decide the data location. Recommended: point at the existing 27GB store so new
  sessions land beside history:
  `LISTENER_DATA_PATH=/ruby/data/experiments/listener_wretch/data`.

## 1. Validate before going live (no triggers yet)

```sh
cd /ruby/data/experiments/faerrin

# a) Dry transcribe of the next real session, keeping the zip and skipping the
#    downstream rebuild — confirms the whisper path end-to-end.
LISTENER_DATA_PATH=/ruby/data/experiments/listener_wretch/data \
LISTENER_KEEP_ZIP=1 LISTENER_SKIP_DOWNSTREAM=1 \
  bun run --filter listener process
# → check saved/{date}/{audio.mp3, script.json} look right.

# b) Dry downstream for that date (wiki + podcast), free TTS:
INGEST_SOURCE=local CASTER_TTS_PROVIDER=edge \
  bash pkg/listener/downstream.sh <date>
# → check the wiki Script page, episodes.json, and the quartz build output.
```

If the byte-for-byte transcript parity matters, compare the regenerated
`pkg/shared-content/scripts/data/<date>.json` against git before committing.

## 2. Install the trigger (systemd user units)

```sh
mkdir -p ~/.config/systemd/user
cp pkg/listener/deploy/listener-reconcile.{service,path} ~/.config/systemd/user/
# EDIT the .service: WorkingDirectory, LISTENER_DATA_PATH, the Craig path in .path.
$EDITOR ~/.config/systemd/user/listener-reconcile.service
$EDITOR ~/.config/systemd/user/listener-reconcile.path

systemctl --user daemon-reload
systemctl --user enable --now listener-reconcile.path

# Run headless (no login session needed):
loginctl enable-linger "$USER"
```

Test it: drop (or `touch`) a zip in the Craig folder and watch:
```sh
journalctl --user -u listener-reconcile.service -f
```

## 3. Cron recovery heartbeat + retire the old jobs

`crontab -e` — replace the old listener job, add the recovery sweep, and remove
the now-redundant standalone quartz build (the reconciler rebuilds quartz):

```cron
# was: 30 2 * * * /emerald/data/experiments/listener_wretch/process.sh
30 2 * * * systemctl --user start listener-reconcile.service

# remove this — downstream.sh now builds quartz on new content:
# 12 * * * * /emerald/data/experiments/quartz/build.sh
```

## 4. Audio host (yours, out-of-band)

The transcript seam is now local (`INGEST_SOURCE=local`); only `audio.mp3` still
needs HTTP serving. Point your reverse proxy at the saved dir so
`static-audio.iridi.cc/{date}/audio.mp3` → `${LISTENER_DATA_PATH}/saved/{date}/audio.mp3`.
(Keep the host name `static-audio.iridi.cc` unless you also change
`shared-content/scripts/config.ts → remote.baseUrl` and regenerate the data files.)

## 5. Decommission the old project

Once a full real cycle runs in-repo (zip → transcript → wiki + podcast live),
retire `/ruby/data/experiments/listener_wretch` — but keep its `data/` (the 27GB
store) if `LISTENER_DATA_PATH` points at it.

## Rollback

The default `INGEST_SOURCE` is still `remote`, and the old `process:py` path and
crons can be restored from history. To pause the new trigger:
`systemctl --user disable --now listener-reconcile.path`.

## Knobs

| Env | Default | Effect |
|-----|---------|--------|
| `LISTENER_DATA_PATH` | `pkg/listener/data` | where `saved/{date}/` lives |
| `LISTENER_KEEP_ZIP` | unset | `1` = don't delete source zips |
| `LISTENER_SKIP_DOWNSTREAM` | unset | `1` = transcribe only |
| `LISTENER_DOWNSTREAM_CMD` | `downstream.sh` | override the cascade hook |
| `INGEST_SOURCE` | `remote` | `local` = read transcripts off disk |
| `CASTER_TTS_PROVIDER` | `edge` | `elevenlabs` = paid TTS |
| `SKIP_PODCAST` | unset | `1` = wiki only, skip caster |
