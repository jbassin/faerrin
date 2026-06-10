---
name: lark-discord-music-bot-spec
description: SPECCED (not built) @faerrin/lark discord music bot + web library + Stream Deck API; spec at thoughts/lark/plans/0001
metadata:
  type: project
---

`@faerrin/lark` (pkg/lark, host `lark.iridi.cc`) is **specced but not built** — an NLSpec lives at
`thoughts/lark/plans/0001-discord-music-bot.md` (authored 2026-06-10 via octo:spec).

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
