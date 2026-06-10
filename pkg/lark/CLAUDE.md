# CLAUDE.md — `@faerrin/lark`

Single-guild **Discord music bot** for the Faerrin campaign: joins a voice channel and streams OST
tracks from a curated library, operated via a web UI (`lark.iridi.cc`) and a Stream Deck REST API.

**Plan of record:** [`thoughts/lark/plans/0001-discord-music-bot.md`](../../thoughts/lark/plans/0001-discord-music-bot.md)
(decisions D1–D8, behaviors B1–B26, phasing). Read it before changing scope.

**Status:** Phases 0–6 built and green; **voice confirmed working live.** Everything runs in **one Bun
process** — including voice in-process via `@discordjs/voice` (`src/bot/discord-voice.ts`). Deck
reference: [`docs/stream-deck.md`](./docs/stream-deck.md). Deploy: [`deploy/DEPLOY.md`](./deploy/DEPLOY.md).

### Voice gotchas (learned the hard way — this took a marathon to find)

- **DAVE / E2EE is mandatory.** Discord requires the DAVE end-to-end-encryption protocol and closes
  the voice WS with **code 4017 "E2EE/DAVE protocol required"** otherwise. Needs `@discordjs/voice`
  **≥ 0.19** + the native **`@snazzah/davey`** (an `optionalDependency`, so the CI bun lane stays
  installable; it loads fine under Bun). **0.18 has no DAVE → never reaches Ready. Don't downgrade.**
  This was THE blocker — not Bun. Bun does voice fine with the right deps.
- **This host's IPv6 is broken** (ULA only, no route). Discord voice (`*.discord.media`) advertises
  AAAA, so `startBot` calls `dns.setDefaultResultOrder("ipv4first")` process-wide before connecting.
- To debug a stuck voice connection, set `debug: true` on `joinVoiceChannel` and hook the **raw ws
  `close` event** for the code (e.g. 4017) — state transitions alone won't tell you. Don't guess
  (we burned hours blaming Bun/Node/IPv6/UDP/OOM before reading the close code).
- Pure-JS deps keep the CI bun lane native-free for the rest: `opusscript` (Opus) + `@noble/ciphers`
  (transport encryption); `libsodium-wrappers` was rejected (broken ESM under Bun). `@snazzah/davey`
  is the one native module, and it's optional.

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

## Voice spike history (D1)

`src/spike/voice-spike.ts` (`bun run spike`) was the Phase 0 PoC. Its early `AbortError` at
"joining voice" was misread as "Bun can't do voice" and triggered a (now-removed) Node-subprocess
detour — but the real cause was the DAVE 4017 close on `@discordjs/voice` 0.18 (see voice gotchas).
With ≥0.19 + `@snazzah/davey`, **Bun runs voice in-process fine**; the spike now works against a live
channel.

## Conventions

- **Bun everywhere** (`bun test`, `bun run`); extends the root `tsconfig.base.json`.
- lark needs its **own** Discord application/token — separate from `@faerrin/mouth` (the dice bot) —
  with the `GuildVoiceStates` intent + Connect/Speak perms.
- Each package's `.env` is gitignored and process-cwd-local; there is **no root `.env`**.
- Deploy mirrors eerie/mouth: systemd user unit + `EnvironmentFile` + a Caddy route. _(Phase 6)_
