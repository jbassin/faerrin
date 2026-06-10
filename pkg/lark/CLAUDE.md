# CLAUDE.md — `@faerrin/lark`

Single-guild **Discord music bot** for the Faerrin campaign: joins a voice channel and streams OST
tracks from a curated library, operated via a web UI (`lark.iridi.cc`) and a Stream Deck REST API.

**Plan of record:** [`thoughts/lark/plans/0001-discord-music-bot.md`](../../thoughts/lark/plans/0001-discord-music-bot.md)
(decisions D1–D8, behaviors B1–B26, phasing). Read it before changing scope.

**Status:** Phases 0–6 built and green. **D1 resolved:** Bun **cannot** run `@discordjs/voice` (the
spike aborts at "joining voice" — `node:dgram`/UDP gaps), so voice runs in a **Node subprocess** (the
voice daemon) while the server/DB/engine stay on Bun. Deck endpoint reference:
[`docs/stream-deck.md`](./docs/stream-deck.md). Deploy: [`deploy/DEPLOY.md`](./deploy/DEPLOY.md).

## Voice runs in a Node subprocess (the D1 fallback)

- `src/bot/voice-daemon.mjs` — plain-JS **Node** process: the discord.js gateway + `@discordjs/voice`.
  Speaks a newline-JSON protocol on stdio (commands in, responses/events out; logs on stderr).
- `src/bot/subprocess-voice.ts` — Bun-side `SubprocessBot` implementing the engine's `VoiceAdapter`
  + resolver, proxying to the daemon. The engine + its tests are unchanged (still use a `FakeVoice`).
- Needs a **`node` binary** at runtime. If `node` isn't on the service PATH (e.g. nvm), set
  **`LARK_NODE_BIN`** to its absolute path (`which node`).
- The `.mjs` daemon is excluded from `tsc` (`tsconfig.json` exclude) — it's plain JS, run by Node.

### Voice gotchas (learned the hard way)

- **DAVE / E2EE is mandatory.** Discord now requires the DAVE end-to-end-encryption protocol and
  closes the voice WS with **code 4017 "E2EE/DAVE protocol required"** otherwise. This needs
  `@discordjs/voice` **≥ 0.19** + the native **`@snazzah/davey`** (an `optionalDependency`). 0.18 has
  no DAVE → never reaches Ready. Don't downgrade below 0.19.
- **This host's IPv6 is broken** (ULA only, no route). Discord voice (`*.discord.media`) advertises
  AAAA, so the daemon forces IPv4: `dns.setDefaultResultOrder("ipv4first")` **and** the
  `--dns-result-order=ipv4first` node flag (the in-code call alone was bypassed by the voice ws).
- To debug a stuck voice connection, set `debug: true` on `joinVoiceChannel` and log `conn.on("debug")`
  — the raw WS close code (e.g. 4017) is the answer. Bun itself was never the problem.

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

`src/spike/voice-spike.ts` (`bun run spike`) was the Phase 0 PoC. Running it live **proved Bun
cannot do voice**: it logs in, then `entersState(Ready)` aborts at "joining voice" (`AbortError`).
That triggered the §11.1 fallback — voice now runs under Node (above). The spike remains as a
Bun-voice regression marker; the real path is the Node daemon. The CI bun lane stays native-free
regardless (`opusscript` + `@noble/ciphers` are pure-JS; `libsodium-wrappers` was rejected — broken
ESM under Bun).

## Conventions

- **Bun everywhere** (`bun test`, `bun run`); extends the root `tsconfig.base.json`.
- lark needs its **own** Discord application/token — separate from `@faerrin/mouth` (the dice bot) —
  with the `GuildVoiceStates` intent + Connect/Speak perms.
- Each package's `.env` is gitignored and process-cwd-local; there is **no root `.env`**.
- Deploy mirrors eerie/mouth: systemd user unit + `EnvironmentFile` + a Caddy route. _(Phase 6)_
