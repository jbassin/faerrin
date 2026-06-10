---
name: lark-discord-music-bot-spec
description: BUILT (phases 0-6, on main) @faerrin/lark discord music bot + web library + Stream Deck API; one live-voice gate left
metadata:
  type: project
---

`@faerrin/lark` (pkg/lark, host `lark.iridi.cc`) is **built and on `main`** (phases 0–6, whole
workspace green, 106 lark tests). NLSpec: `thoughts/lark/plans/0001-discord-music-bot.md` (authored
2026-06-10 via octo:spec; implemented 2026-06-10 via octo:embrace).

**Built:** Bun `server.ts` (eerie-pattern testable `handle`), `bun:sqlite` schema+migrations, Discord
OAuth+session auth, library CRUD + bulk-rename(preview)/bulk-tag + upload, yt-dlp single/playlist
ingest with SSE progress + dedup + R128 loudness, the serialized playback engine (queue/loop/gain/
auto-leave, Discord voice behind an injected `VoiceAdapter`), and the Stream Deck API (dual session/
key auth, web-UI key mgmt, `docs/stream-deck.md`). Deploy: `deploy/lark.service` + `deploy/DEPLOY.md`;
caddy route added to the host's gitignored `sites.caddyfile` (port 8788).

**D1 RESOLVED (the hard way):** the live spike proved **Bun cannot run `@discordjs/voice`** —
`entersState(Ready)` aborts at "joining voice" (`AbortError`/`ABORT_ERR`; Bun `node:dgram`/UDP gaps).
So voice now runs in a **Node subprocess** (`src/bot/voice-daemon.mjs`, plain JS) driven by the
Bun-side `SubprocessBot` (`src/bot/subprocess-voice.ts`) over newline-JSON on stdio; server/DB/engine
stay on Bun, engine unchanged (still `FakeVoice` in tests). Needs a `node` binary — set
**`LARK_NODE_BIN`** if not on the service PATH (nvm). The old in-process `DiscordVoiceAdapter` +
`bun run spike` are gone/legacy. Also from Phase 0: `libsodium-wrappers` ESM is broken under Bun →
use **`@noble/ciphers`** (pure-JS) for voice encryption, `opusscript` for Opus (CI bun lane native-free).

Other live-debugging fixes that landed: follow-the-operator resolution falls back to the Discord REST
voice-state endpoint when the gateway cache misses (`GET /guilds/{g}/voice-states/{u}`); the Import UI
auto-reattaches to in-flight ingest jobs on load; `GET /api/v1/voice/debug` reports uid/guild/resolved
channel for diagnosis. **Still not live-validated end-to-end** (no token in-session), but the Node
voice path is the architecture.

It's a **single-guild Discord music bot** (audio-only — Discord has no bot video API) that joins a
voice channel and streams video-game OSTs from a curated library: collections (by game/IP), a flexible
free-form **tag** system (`calm`/`explore`/`dungeon`/`vocals`…), playlists, looping, and **auto-leave
when the last human leaves**. Library is curated via a web UI; a **Stream Deck REST API** (key-auth)
controls playback (stop / play / list-by-album-or-tag / now-playing). **Loudness normalization (EBU
R128, ~−16 LUFS) is an in-scope v1 feature** (B25); **crossfade/gapless is an explicit post-v1 want**
— the playback engine must be designed decode-ahead/mix-capable so it can be added without a rewrite.

**Locked decisions (with the user):**
- Runtime/voice: **Bun + `@discordjs/voice`**, one all-TS package (matches "Bun everywhere"). The **#1
  risk** is Bun voice maturity → mandatory **Phase 0 spike**; fallback is running the bot as a Node
  subprocess.
- **Audio-only** (no video/screenshare — unsupported by Discord bots).
- **Single guild** (the campaign server), one voice session, one shared library.
- Auth: **Discord OAuth2 → session cookie** (user-ID allowlist) for the web UI; the Stream Deck uses
  **API keys the operator generates in the web UI** (shown once, stored hashed, **bound to their
  Discord user** — so the deck inherits identity for follow-the-operator; no static env key).

**Grounded in repo precedent:** extends eerie's `Bun.serve` `createApp()/startServer()` testable-handler
+ token-auth + systemd+Caddy pattern; adds `bun:sqlite`, a voice engine, and a **yt-dlp + ffmpeg**
ingest pipeline (single video → audio; playlist → whole collection with per-item SSE download progress;
bulk rename/tag for noisy YT titles). Needs its **own** Discord app/token (separate from [[speaks-migration]]'s
mouth dice bot). **CI gotcha:** the Dagger `oven/bun` container lacks ffmpeg/yt-dlp and may not build
native voice modules — tests/typecheck must pass without them (gate integration behind an env flag,
like eerie). Related: [[eerie-obs-overlay-plan]], [[dice-data-webui-plan]].
