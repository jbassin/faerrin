# lark — Stream Deck / control API

A small REST API for driving lark from an Elgato Stream Deck (or any HTTP client).
Base URL: `https://lark.iridi.cc`. All `/api/v1/*` routes accept **either** a web session
cookie **or** a Stream Deck API key.

## Auth

Generate a key in the web UI (signed in): **Settings → API keys → New key**. The raw key is shown
**once** — copy it into your Stream Deck button's HTTP request. Send it as either header:

```
Authorization: Bearer lark_xxxxxxxxxx…
# or
X-Lark-Key: lark_xxxxxxxxxx…
```

The key is bound to your Discord user, so "play" follows **you** into whatever voice channel you're
currently in (no channel id needed). Revoke a key any time in the UI; revoked keys return `401`.

## Endpoints (the ones you'll bind to buttons)

| Button | Request |
|--------|---------|
| **Stop** | `POST /api/v1/playback/stop` |
| **Play a track** | `POST /api/v1/playback/play` body `{"trackId": 123}` |
| **Play a collection** | `POST /api/v1/playback/play` body `{"collectionId": 7}` |
| **Play a playlist** | `POST /api/v1/playback/play` body `{"playlistId": 4}` |
| **Pause / Resume** | `POST /api/v1/playback/pause` · `POST /api/v1/playback/resume` |
| **Next / Prev** | `POST /api/v1/playback/next` · `POST /api/v1/playback/prev` |
| **Set loop** | `POST /api/v1/playback/loop` body `{"mode":"none"\|"track"\|"playlist"}` |
| **Now playing** | `GET /api/v1/playback/now` |
| **List tracks** | `GET /api/v1/tracks?collection=<id>&tag=<id>&q=<text>` |
| **List collections / tags / playlists** | `GET /api/v1/collections` · `/api/v1/tags` · `/api/v1/playlists` |
| **Join / leave voice** | `POST /api/v1/voice/join` (optional `{"channelId":"…"}`) · `POST /api/v1/voice/leave` |

### Now-playing response

```json
{
  "connected": true,
  "channelId": "123…",
  "status": "playing",
  "loopMode": "playlist",
  "current": { "trackId": 12, "title": "Boss Theme", "positionMs": 41000, "durationMs": 184000 },
  "queueLength": 14,
  "queueIndex": 3
}
```

### Status codes

- `401` — missing/invalid/revoked key.
- `409` — "join a voice channel first" (you're not in a voice channel and gave no `channelId`).
- `503` — the Discord bot isn't running (no token configured).

> Key **management** (`GET/POST/DELETE /api/v1/keys`) requires a logged-in web session — an API key
> cannot create or revoke keys.
