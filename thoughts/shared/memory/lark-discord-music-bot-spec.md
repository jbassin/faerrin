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

**VOICE WORKS — confirmed live 2026-06-10** (`STATE connecting → ready`). The marathon debug's REAL
cause: Discord **requires the DAVE E2EE protocol** and closes the voice WS with **code 4017 "E2EE/DAVE
protocol required"**. `@discordjs/voice` **0.18 has NO DAVE support** → never reached Ready. **Fix:
`@discordjs/voice` ≥0.19.2 + native `@snazzah/davey` (optionalDependency).** Don't downgrade below 0.19.

Voice runs in a **Node subprocess** (`src/bot/voice-daemon.mjs`, plain JS) driven by the Bun-side
`SubprocessBot` (`src/bot/subprocess-voice.ts`) over newline-JSON stdio; server/DB/engine stay on Bun,
engine unchanged (`FakeVoice` in tests). (Bun *also* can't do voice, but the Node split was needed
regardless.) Host quirk: **broken IPv6** (ULA only) vs Discord voice's AAAA records → daemon forces
IPv4 (`dns.setDefaultResultOrder("ipv4first")` + `--dns-result-order=ipv4first` node flag). Needs a
`node` binary — set **`LARK_NODE_BIN`** if not on the service PATH (nvm). `libsodium-wrappers` is broken
under Bun → `@noble/ciphers` + `opusscript` (pure-JS, CI native-free).

**To debug a stuck voice connection:** hook the raw ws `close` event for the code (don't guess) —
that's how 4017 surfaced. Red herrings ruled out: Bun-vs-Node, the resolver, OAuth, OOM (MemoryMax
raised to **16G** on the 62GiB host; ingest throttled to concurrency 2 + optional loudness), UDP
egress, port filtering — all fine. Other fixes that landed: REST voice-state fallback on cache miss;
Import UI auto-reattach to in-flight jobs; `reconcileInterruptedJobs` clears zombie imports on restart;
`GET /api/v1/voice/debug`; stateless signed OAuth state + bot-install-redirect guidance.

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
