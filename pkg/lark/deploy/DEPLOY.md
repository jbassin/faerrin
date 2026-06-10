# lark — deploy runbook

Take lark live as a **systemd user service** on the same host that runs aether/Caddy + mouth + eerie,
isolated so it can never threaten `heart.iridi.cc`. Mirrors eerie/mouth discipline (bare systemd user
unit, no container; config via `EnvironmentFile`). **All host steps are manual.**

Plan of record: `thoughts/lark/plans/0001-discord-music-bot.md`.

## What lark is

One Bun process (`server.ts`) doing several jobs on one port (default `8788`):

- `GET /*` — serves the built SPA (`dist/`).
- `/api/v1/*` — JSON API + Stream Deck control (session cookie **or** API key).
- SSE — `…/ingest/jobs/:id/events` (download progress) and now-playing.
- The Discord **voice/playback bot** — only when `DISCORD_TOKEN` + `LARK_GUILD_ID` are set.

## 0. Prerequisites (host)

- Bun (already at `/home/jbassin/.bun/bin/bun`).
- **`yt-dlp`** and **`ffmpeg`** on `PATH` (ingest + R128 loudness + playback transcode).
  - `yt-dlp` at `/home/jbassin/.local/bin/yt-dlp`, `ffmpeg` at `/usr/bin/ffmpeg` on this host.
  - Keep `yt-dlp` updated (`yt-dlp -U`) — YouTube breaks it periodically.
- A **separate Discord application** from mouth: create a bot, enable the **Server Members** +
  **Voice States** intents, invite it to the guild with **Connect** + **Speak**.
- OAuth2: add `https://lark.iridi.cc/auth/callback` as a redirect URI; note client id/secret.
- A persistent, **backed-up** data dir for the SQLite DB + audio (e.g. `…/pkg/lark/data` or a
  dedicated volume via `LARK_DATA_DIR`). This is **not** a build artifact — don't put it under `dist/`.
- Access to the host's **gitignored** `sites.caddyfile`.

## 1. Build the SPA (produces `dist/`)

```sh
cd /ruby/data/experiments/faerrin
bun install
bun run --filter @faerrin/lark build      # → pkg/lark/dist/
```

`dist/` is gitignored; rebuild after any UI change.

## 2. Configure (`.env`, mode 0600, NOT in git)

```sh
cp pkg/lark/.env.example pkg/lark/.env
chmod 600 pkg/lark/.env
# then edit:
#   PORT=8788
#   DISCORD_TOKEN=…            (lark's own bot)
#   DISCORD_CLIENT_ID=…  DISCORD_CLIENT_SECRET=…
#   SESSION_SECRET=$(openssl rand -hex 32)
#   LARK_ALLOWED_USER_IDS=<your discord user id>[,more]
#   LARK_GUILD_ID=<campaign guild id>
#   LARK_PUBLIC_ORIGIN=https://lark.iridi.cc
#   LARK_DATA_DIR=/path/to/backed-up/data     (optional; defaults to pkg/lark/data)
#   LARK_TARGET_LUFS=-16
```

## 3. Caddy route (host's gitignored `sites.caddyfile`)

Add (the file embeds a Cloudflare token, so it lives only on the host, not in git):

```caddyfile
lark.iridi.cc {
	reverse_proxy localhost:8788
}
```

Reload Caddy after editing.

## 4. systemd user service

```sh
cp pkg/lark/deploy/lark.service ~/.config/systemd/user/lark.service
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now lark.service
systemctl --user status lark.service
journalctl --user -u lark.service -f
```

The unit caps memory/CPU (more generous than eerie because of ffmpeg/yt-dlp) so a runaway can't
threaten `heart.iridi.cc`.

## 5. Phase 0 voice gate (the one manual validation)

Before trusting playback at the table, confirm Bun voice works end-to-end with a real token and a
human in the channel:

```sh
cd pkg/lark
# .env already has DISCORD_TOKEN + LARK_GUILD_ID; add LARK_SPIKE_CHANNEL_ID=<a voice channel id>
bun run spike            # bot joins, plays a 440 Hz tone, leaves
```

Hear clean audio → D1 confirmed. If Bun can't do voice, fall back to running **only** the bot under
Node (server/UI stay on Bun) — plan §11.1.

## 6. Operate

- Sign in at `https://lark.iridi.cc` (Discord OAuth; your user id must be in `LARK_ALLOWED_USER_IDS`).
- Import a YouTube playlist, bulk-rename/tag, build playlists.
- Generate a Stream Deck API key (shown once) and wire deck buttons per `docs/stream-deck.md`.

## Maintenance

- **Disk**: audio accumulates in the data dir; deleting a track frees its file. Monitor free space.
- **yt-dlp**: `yt-dlp -U` when imports start failing.
- **Restart semantics**: playback state is ephemeral — after a restart the bot is idle (by design).
