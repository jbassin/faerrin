# CLAUDE.md — `@faerrin/lark`

Single-guild **Discord music bot** for the Faerrin campaign: joins a voice channel and streams OST
tracks from a curated library, operated via a web UI (`lark.iridi.cc`) and a Stream Deck REST API.

**Plan of record:** [`thoughts/lark/plans/0001-discord-music-bot.md`](../../thoughts/lark/plans/0001-discord-music-bot.md)
(decisions D1–D8, behaviors B1–B26, phasing). Read it before changing scope.

**Status:** Phases 0–6 built and green (skeleton/auth, library + bulk rename/tag, YouTube ingest with
SSE progress, playback engine, Stream Deck API, deploy). The **one remaining gate** is the live voice
test (`bun run spike` with a real token + a human in the channel) — see "Voice spike status" below.
Deck endpoint reference: [`docs/stream-deck.md`](./docs/stream-deck.md). Deploy: [`deploy/DEPLOY.md`](./deploy/DEPLOY.md).

## Architecture (all TypeScript on Bun — D1)

One package, mirroring eerie's `createApp()/startServer()` split so the HTTP layer is unit-testable
without binding a port or touching Discord:

- `src/lib/` — pure, dependency-free helpers (config/env, etc.). **CI-safe** — no native modules.
- `src/spike/` — Phase 0 voice PoC (`bun run spike`). Needs a live token + a human in voice.
- `src/bot/` — Discord client + voice/playback engine (`@discordjs/voice`). _(Phase 4)_
- `src/server/` — `Bun.serve` app: SPA + JSON API + SSE. Testable `handle(req)`. _(Phase 1+)_
- `src/db/` — `bun:sqlite` schema + migrations + queries. _(Phase 1+)_
- `src/web/` — Vite + React 19 SPA. _(Phase 1+)_
- `data/` — gitignored persistent dir: SQLite DB + downloaded/uploaded audio. **Backed up on host.**

## CI-safety (do not break the bun lane — risk §11.2)

The Dagger `oven/bun` container has **no ffmpeg/yt-dlp** and may not build native modules. So:

- Voice deps are **pure-JS**: `opusscript` (Opus) + `@noble/ciphers` (AEAD encryption), **not** the
  native `@discordjs/opus`/`sodium-native`. (`libsodium-wrappers` was rejected — its ESM entry fails
  to resolve under Bun.) The host may add the native ones for speed; never make them a hard dependency.
- `tsc --noEmit` and `bun test` MUST pass with **no** ffmpeg/yt-dlp/Discord present. Anything that
  shells out to those binaries or hits Discord goes behind an integration flag, never in unit tests.

## Voice spike status (D1 gate)

Phase 0 ships a runnable spike but the **live audio test is the one manual hand-off** (token + a
human in the channel). To run it:

```sh
cd pkg/lark && cp .env.example .env   # fill DISCORD_TOKEN, LARK_GUILD_ID, LARK_SPIKE_CHANNEL_ID
bun run spike                         # plays a generated 440 Hz tone, then leaves
```

Hear clean audio → D1 confirmed (Bun is the runtime). If Bun can't do voice, fall back to running
**only** the bot under Node (server/UI stay on Bun) — plan §11.1.

## Conventions

- **Bun everywhere** (`bun test`, `bun run`); extends the root `tsconfig.base.json`.
- lark needs its **own** Discord application/token — separate from `@faerrin/mouth` (the dice bot) —
  with the `GuildVoiceStates` intent + Connect/Speak perms.
- Each package's `.env` is gitignored and process-cwd-local; there is **no root `.env`**.
- Deploy mirrors eerie/mouth: systemd user unit + `EnvironmentFile` + a Caddy route. _(Phase 6)_
