# NLSpec 0001 — `@faerrin/lark`: Discord music bot + web library + Stream Deck API

**Status:** Draft spec (pre-implementation). **Author:** spec workflow (octo:spec, team mode / Claude personas).
**Date:** 2026-06-10. **Package:** `@faerrin/lark` at `pkg/lark`. **Public host:** `lark.iridi.cc`.

> This is a *specification*, not an implementation. It freezes scope, the data contract, the API
> surface, and the build phasing so a follow-up `implement-plan` pass (or `/octo:embrace` Develop)
> can build it. Conventions are grounded in the two closest in-repo precedents: **`mouth`** (Rust
> serenity Discord bot — but dice-only, *no* voice) and **`eerie`** (Bun + Vite/React 19 web service
> with token auth, SSE, systemd+Caddy deploy). lark is "eerie's server pattern + a real DB + a voice
> engine + a yt-dlp ingest pipeline."

---

## 1. Overview

lark is a **single-guild Discord music bot** for the Faerrin PF2e campaign. It joins a Discord
**voice** channel and streams **audio** (single long tracks or playlists of mostly video-game OST
tracks). The library is curated and operated through a web UI at `lark.iridi.cc`, and a small REST
**control API** drives an Elgato Stream Deck.

It is a **separate Discord application/bot token from `mouth`** (mouth handles dice/host in text;
lark handles voice) so both can be present in the campaign server simultaneously.

### Resolved decisions (locked with the user 2026-06-10)

| # | Decision | Choice | Consequence |
|---|----------|--------|-------------|
| D1 | Runtime / voice stack | **Bun + `@discordjs/voice`** — one all-TypeScript package | Matches the repo's "Bun everywhere" rule; bot + HTTP server + SPA share one codebase. **Carries the project's #1 risk** (Bun voice maturity) → mandatory Phase 0 spike. |
| D2 | Audio vs video | **Audio-only** | Discord's bot API has no supported video/screenshare transmit. Standard music-bot behavior. Video is **out of scope**. |
| D3 | Guild scope | **Single guild** (the campaign server) | One active voice session at a time; one shared library; single-tenant data model. |
| D4 | Auth | **Login + sessions** for the web UI (Discord OAuth2 → signed cookie, user-ID allowlist). The Stream Deck uses an **API key the operator generates in the web UI**, stored **hashed** and **bound to their Discord user** | One allowlist; each deck key carries a real user identity (which feeds D8 — no separate operator-id config). |
| D5 | Loudness normalization | **Measure R128 on ingest, apply as gain at playback** (ReplayGain-style) | Source kept as-is, no normalization re-encode; per-track LUFS stored; retargetable. |
| D6 | "Stop" semantics | **Stay connected, clear queue** | Next `play` is instant; bot leaves only via auto-leave (D7) or explicit `leave`. |
| D7 | Auto-leave debounce | **60 seconds** | Generous grace for drop/rejoin/short breaks before disconnecting. |
| D8 | Channel selection | **Follow the operator** — join the voice channel the requester is currently in | Web: the OAuth'd user's voice state. Deck: the **Discord user bound to the API key** (D4). Optional explicit `channelId` override. |

---

## 2. Actors

- **Operator (host/DM)** — authenticates to the web UI via Discord OAuth; curates the library
  (upload, YouTube ingest, rename, tag, build collections/playlists) and controls playback. Identified
  by an allowlisted Discord user ID.
- **Stream Deck** — a headless HTTP client authenticating with the API key; issues playback commands
  and reads now-playing/list info. No web session.
- **Discord listeners** — non-bot members in the voice channel. Their presence/absence drives
  auto-leave; they do not control lark directly (control is web/deck only in v1 — optional in-Discord
  slash commands are a deferred nice-to-have, §12).
- **lark bot** — the Discord application/voice client itself (a "non-human" member of the channel).
- **External tools** — `yt-dlp` and `ffmpeg` (host binaries) for ingest/transcode.

---

## 3. Glossary (the data contract's nouns)

- **Track** — one playable audio asset (an uploaded file or a downloaded YouTube video's audio). Has
  an editable **display title** distinct from its long **original title**.
- **Collection** (a.k.a. album) — a library grouping, **usually by game/IP** the OST came from. A
  YouTube playlist import creates one collection. A track belongs to **at most one** collection.
- **Tag** — a flexible, free-form label on a track (`calm`, `explore`, `dungeon`, `vocals`, …).
  Many-to-many. The system imposes **no fixed taxonomy**; tags are user-defined and growable.
- **Playlist** — an **ordered, named sequence of tracks** the operator assembles for playback,
  possibly spanning collections. Distinct from a collection (a library grouping) and from the queue (a
  runtime structure).
- **Queue** — the **runtime** ordered list of upcoming tracks for the active voice session (seeded
  from a track, a collection, or a playlist).
- **Now-playing / playback state** — ephemeral runtime state: active voice channel, current track,
  position, loop mode, queue. **Not persisted across restarts** (acceptable for single-operator use).
- **Download job** — an ingest unit (single video or whole playlist) with per-item progress.

---

## 4. Technology stack

All TypeScript, Bun runtime (D1). One package, mirroring eerie's `createApp()/startServer()` split so
the HTTP layer is unit-testable without binding a port or touching Discord.

| Concern | Choice | Notes |
|---------|--------|-------|
| Language/runtime | TypeScript on **Bun** | `extends` root `tsconfig.base.json` (non-Astro app, like eerie). |
| Discord | **`discord.js` v14** + **`@discordjs/voice`** + **`@discordjs/opus`** + `libsodium-wrappers`/`sodium-native` + `prism-media` (ffmpeg pipe) | Voice gateway, Opus encode, encryption, transcode. **Bun-compat is the spike (Phase 0).** |
| HTTP server | **`Bun.serve`** (eerie pattern) | One process: serves built SPA + JSON API + SSE (download & playback progress). Testable `handle(req)`. |
| Web UI | **Vite + React 19** | Matches eerie/vellum. Optionally skin with **`@faerrin/gothic`** for visual consistency with the other sites (recommended, not required). |
| Database | **`bun:sqlite`** (native; precedent in `mouth/scripts` and `aether/scripts`) + a thin typed migration runner (Drizzle optional for typed schema/migrations) | Single-file DB in the data dir. FTS5 for search is optional (§12). |
| Media ingest | **`yt-dlp`** (download/enumerate) + **`ffmpeg`** (R128 **loudness measurement on ingest**; transcode-to-Opus **and gain application at playback**) — external host binaries | Source kept as-is (D5); ffmpeg in the play chain applies the measured gain + Opus-encodes for Discord. Versioned/updatable; **not bundled**; presence checked at startup (B25). |
| Audio storage | **Local filesystem** under a persistent data dir | Grows over time → disk planning (§10). |
| Auth (web) | **Discord OAuth2** (authorization-code) → signed **HttpOnly** session cookie; **allowlist** of Discord user IDs | CSRF protection on state-changing routes. |
| Auth (API) | **Static API key** (`Authorization: Bearer` or `X-Lark-Key`), env/DB-configured | For the Stream Deck; no cookie/session. |
| Deploy | **systemd user unit** + `EnvironmentFile` + Caddy route (eerie/mouth discipline) | `lark.iridi.cc` added to the gitignored `sites.caddyfile`; host cutover is manual. |

### Package wiring (workspace conventions)

- A **script-ful** Bun member (unlike gothic/mouth): `dev`, `dev:server`, `build` (Vite → `dist/`),
  `start` (`bun run server.ts`), `typecheck` (`tsc --noEmit`), `test` (`bun test`).
- **Declare every imported dependency** in `package.json` (hoisting hides phantom deps — bit strider).
- Root fan-out (`bun --filter '*' typecheck|test|build`) must stay green.
- **`pkg/lark/CLAUDE.md`** documents local detail (voice spike status, data-dir layout, deploy).

---

## 5. Data model (SQLite)

> Single-tenant; no per-guild scoping (D3). IDs are integer PKs unless noted. Timestamps are UTC ISO.

```
collections
  id, name, slug (unique), ip_or_game (nullable),
  source_type ('manual' | 'youtube_playlist'), source_url (nullable),
  cover_url (nullable), created_at, updated_at

tracks
  id, collection_id (nullable FK → collections),
  title            -- editable display title
  original_title   -- as-ingested (e.g., long YouTube title)
  source_type ('upload' | 'youtube'), source_url (nullable),
  source_video_id (nullable, unique-ish for dedup),
  file_path, format, duration_ms, file_size,
  loudness_lufs (nullable REAL -- measured R128 integrated loudness, for playback gain, D5/B25),
  status ('ready' | 'downloading' | 'error'), error (nullable),
  added_at, updated_at

tags
  id, name (unique, normalized: trimmed/lowercased), category (nullable, free-form e.g. 'mood'|'content'),
  created_at

track_tags  (M:N)
  track_id FK, tag_id FK, PRIMARY KEY (track_id, tag_id)

playlists
  id, name, loop_mode ('none' | 'track' | 'playlist'), shuffle (bool), created_at, updated_at

playlist_items  (ordered)
  id, playlist_id FK, track_id FK, position

download_jobs
  id, type ('single' | 'playlist'), source_url, title (nullable),
  collection_id (nullable FK — created/target collection for playlist imports),
  status ('queued' | 'running' | 'done' | 'error' | 'partial'),
  total_items, completed_items, error (nullable), created_at, updated_at

download_job_items  (per video in a job)
  id, job_id FK, video_id, title, position,
  status ('queued' | 'downloading' | 'done' | 'error'),
  progress_pct, error (nullable), track_id (nullable FK — set on success)

api_keys            -- Stream Deck keys, each generated in the web UI and bound to a Discord user (D4)
  id, user_id (Discord user ID of the creator; must be allowlisted),
  name (operator label, e.g. 'Stream Deck'),
  key_hash, key_prefix (first few chars, non-secret, for display/identification),
  created_at, last_used_at, revoked_at (nullable)
```

Sessions need no table: the cookie is a signed token; the allowlist of Discord user IDs is
env-configured. `api_keys` rows are the durable, per-user deck credentials (the raw key is never
stored — only its hash).

---

## 6. Functional behaviors (with acceptance criteria)

Format: **B# — name.** *Behavior.* → **Accept:** verifiable condition.

### Voice session

- **B1 — Join (follow the operator).** lark joins the voice channel the **requesting operator is
  currently in** (D8): for a web request, the OAuth'd user's live voice state in the guild; for a
  Stream Deck request, the voice state of the **Discord user bound to the API key** (D4). An explicit
  `channelId` in the request **overrides** the follow behavior. If the operator is in
  no voice channel and no explicit channel is given, the command fails with a clear error (`409`,
  "join a voice channel first"). → **Accept:** with the operator in channel X, a no-argument
  `play`/`join` lands the bot in X; `now-playing` reports X. One active session only (D3) — a join
  while connected elsewhere moves the bot to the new channel.
  - **Requires the `GuildVoiceStates` gateway intent** to read member voice presence.
- **B2 — Auto-leave on empty.** When the last **non-bot** member leaves the active channel, lark
  **stops playback and disconnects**, after a **60 s debounce** (D7) to tolerate leave/rejoin churn and
  short breaks. → **Accept:** with only the bot remaining for > 60 s, playback stops and the voice
  connection closes; `now-playing` returns idle; a human rejoining within 60 s cancels the leave.
- **B3 — Reconnect.** A transient voice/gateway drop attempts bounded reconnection; on permanent
  failure, session goes idle and surfaces an error. → **Accept:** simulated drop reconnects without
  operator action, or cleanly idles.

### Playback

- **B4 — Play a track / collection / playlist.** Start playback from a single track, or seed the queue
  from a collection or playlist. → **Accept:** audio is audible in-channel; `now-playing` reflects the
  current track and remaining queue.
- **B5 — Stop.** Stop the current track and clear playback (queue cleared or paused per "stop"
  semantics — **stop = halt + clear queue + stay connected**; auto-leave still governed by B2). →
  **Accept:** audio halts; `now-playing` shows idle/connected.
- **B6 — Pause/Resume.** → **Accept:** audio pauses and resumes from the same position.
- **B7 — Skip / Next (and Previous).** Advance to the next queued track (or previous). → **Accept:**
  current track changes accordingly; end-of-queue behavior follows loop mode (B9).
- **B8 — Loop modes.** `none` (stop at queue end), `track` (repeat current), `playlist` (repeat
  queue). Settable at runtime. → **Accept:** each mode produces the specified end-of-track behavior.
- **B9 — Single source of truth.** Web UI and Stream Deck both mutate **one** playback engine;
  concurrent commands are **serialized** (last-writer-wins per command, no split state). → **Accept:**
  interleaved web+deck commands never desync `now-playing`.
- **B10 — Resilient track failure.** A missing/corrupt file at play time is **skipped** and marked
  `status='error'`; the queue continues. → **Accept:** a deliberately broken track does not wedge
  playback.

### Library management (web UI)

- **B11 — Browse/filter.** List tracks **by collection** and **by tag** (and free-text search on
  title). → **Accept:** filtering by a tag returns exactly the tagged tracks; by collection returns its
  tracks.
- **B12 — Rename (single).** Edit a track's display `title` (original preserved). → **Accept:** new
  title shown everywhere; `original_title` unchanged.
- **B13 — Bulk rename.** Operate on a multi-select: find/replace, regex, strip-prefix/suffix, or
  template — with a **preview** before applying (YT titles are long/noisy). → **Accept:** a regex strip
  applied to N selected tracks updates exactly those N titles; preview matches result.
- **B14 — Bulk tag / untag.** Add or remove one or more tags across a multi-select. → **Accept:**
  adding `calm` to N tracks creates the M:N rows for exactly those N.
- **B15 — Collections CRUD + move.** Create/rename/delete collections; move tracks between them. →
  **Accept:** moved track's `collection_id` updates; deleting a collection reassigns tracks to
  none (does **not** delete tracks/files unless explicitly chosen).
- **B16 — Tags CRUD.** Create/rename/merge/delete tags; names normalized (trim/case) to avoid
  duplicates. → **Accept:** creating `Calm` and `calm` resolves to one tag.
- **B17 — Playlists CRUD + ordering.** Create playlists; add/remove/reorder tracks; set loop/shuffle.
  → **Accept:** reordering persists `position`; playing the playlist follows that order.
- **B18 — Delete track.** Delete a track and its underlying file (with confirmation). → **Accept:**
  row + file removed; M:N rows cascade.

### Ingest

- **B19 — Upload.** Upload one or more audio files (multipart); each is stored, probed
  (duration/format) and—if needed—**transcoded** to a playback-friendly format; a `Track` is created.
  → **Accept:** an uploaded file becomes a `ready` track playable in-channel.
- **B20 — YouTube single.** Given a single-video URL, download **bestaudio**, create one track
  (display title defaulted from the video title, editable). → **Accept:** a single-video URL yields one
  `ready` track.
- **B21 — YouTube playlist.** Given a playlist URL, **enumerate every video** (`yt-dlp --flat-playlist`),
  create a `download_job` + per-video `download_job_items`, create a **collection** named from the
  playlist (editable), and download all items, creating a track per success. → **Accept:** an N-video
  playlist produces a collection with up to N `ready` tracks; failures are marked `error` and don't
  abort the job (`status='partial'`).
- **B22 — Download progress UI.** While a job runs, the UI shows **each video and its progress** via an
  **SSE** stream (per-item `progress_pct` and status). → **Accept:** the UI reflects per-item progress
  in near-real-time; reconnecting mid-job resumes the live view.
- **B23 — Dedup (best-effort).** Re-ingesting a video already present (by `source_video_id`) is flagged
  rather than silently duplicated. → **Accept:** importing the same video twice warns/skips.
- **B24 — Concurrency + isolation.** Downloads run in a **bounded worker pool** and never block
  playback or the HTTP server. → **Accept:** a large playlist download keeps `now-playing` responsive.
- **B25 — Loudness normalization (in scope, D5).** On ingest, each track's integrated loudness is
  **measured** (EBU R128, `ffmpeg ebur128`/`loudnorm` analysis pass) and stored (`loudness_lufs`). At
  **playback**, lark applies the correction toward the target (**default −16 LUFS**) as **live gain** in
  the ffmpeg play chain (ReplayGain-style) — **no normalization re-encode of the stored file**. The
  target LUFS is configurable, and because only the measured value is stored, retargeting needs no
  re-ingest. A true-peak limiter guards against clipping when gaining up. → **Accept:** two tracks with
  very different source loudness play at perceptually even volume; each track's measured LUFS is
  recorded; changing the target LUFS changes playback without re-processing files.

### Operator / API keys

- **B26 — Generate a Stream Deck API key (web UI, D4).** A logged-in, allowlisted operator can
  **generate** a named API key for their Stream Deck, **see the raw key exactly once** at creation,
  **list** their existing keys (label, prefix, created/last-used), and **revoke** any of them. Each key
  is **bound to the creator's Discord user ID**, so deck requests using it inherit that user's identity
  for follow-the-operator (D8) and for the allowlist check. → **Accept:** a freshly generated key
  authenticates deck requests and resolves voice-channel as its owner; the raw key is shown once and
  never retrievable again; revoking a key makes its subsequent requests `401`; a key whose owner is no
  longer allowlisted is rejected.

---

## 7. HTTP surface

Two audiences on one Bun server: the **web UI** (cookie/session, full CRUD) and the **Stream Deck
control API** (API key, the explicitly-requested endpoints + the minimum to be useful). Versioned under
`/api/v1`.

### Stream Deck control API (API-key auth) — the user's required endpoints, plus essentials

| Method & path | Purpose |
|---|---|
| `POST /api/v1/playback/stop` | **Stop the current track** (B5). |
| `POST /api/v1/playback/play` | **Play a track** — body `{ trackId }` (or `{ collectionId }` / `{ playlistId }`) (B4). |
| `GET  /api/v1/tracks?collection=&tag=&q=&page=` | **List tracks by album / by tag** (B11). |
| `GET  /api/v1/playback/now` | **Current playback info**: channel, track, position/duration, loop mode, queue length (§3). |
| `POST /api/v1/playback/pause` · `…/resume` · `…/next` · `…/prev` | Transport (B6/B7) — for a fuller deck. |
| `POST /api/v1/playback/loop` | Set loop mode `{ mode }` (B8). |
| `POST /api/v1/voice/join` · `…/leave` | Join a channel / disconnect (B1). |
| `GET  /api/v1/collections` · `GET /api/v1/tags` · `GET /api/v1/playlists` | Browse for deck buttons. |

Responses are JSON; errors use standard codes (`400` bad body, `401` unauthorized, `404` unknown
id, `409` conflicting session, `503` voice/ingest unavailable). Control latency target < 200 ms.

### Web-UI API (session-cookie auth) — superset

All of the above **plus** the mutating management routes backing §6: track rename/bulk-rename
(`PATCH /tracks`, `POST /tracks/bulk-rename` with **preview** mode), bulk-tag
(`POST /tracks/bulk-tag`), collections/tags/playlists CRUD, upload (`POST /ingest/upload`), YouTube
ingest (`POST /ingest/youtube`), download-job status (`GET /ingest/jobs/:id`), the **SSE** streams
(`GET /ingest/jobs/:id/events` for download progress; `GET /playback/events` for now-playing pushes),
the OAuth routes (`GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`), and **API-key
management** (`GET /api/v1/keys`, `POST /api/v1/keys`, `DELETE /api/v1/keys/:id`) — generate / list /
revoke Stream Deck keys bound to the logged-in user; the raw key is returned **only** in the
`POST` response, once (B26).

### Auth middleware

- **Web routes:** require a valid signed session cookie whose Discord user ID is in the allowlist;
  CSRF token on state-changing requests; cookie `HttpOnly; Secure; SameSite=Lax`.
- **API routes:** require the API key header; constant-time compare; `last_used_at` updated.
- **Static SPA + audio previews:** path-traversal-guarded static serving (eerie pattern). Audio
  preview streaming may reuse a `static-audio`-style route (a `static-audio.iridi.cc` Caddy route
  already exists on the host — reuse or add an authenticated `/media/:id` route; default: authenticated
  `/api/v1/media/:trackId` with range support).

---

## 8. Auth & security detail

- **Discord OAuth2** authorization-code flow: `identify` scope only; on callback, verify the user ID
  is allowlisted (env `LARK_ALLOWED_USER_IDS`), then mint a signed session (JWT or signed cookie with a
  server secret). Non-allowlisted users get `403`.
- **API key** for the deck: **minted in the web UI** by a logged-in, allowlisted operator
  (B26) — generated server-side with high entropy, shown to the user **exactly once**, stored only as a
  **hash** (constant-time compare on use) plus a short non-secret prefix for display. Each key is
  **bound to its creator's Discord user ID** and is **revocable** from the UI. Sent as
  `Authorization: Bearer …` / `X-Lark-Key`. Revoking a key — or its owner dropping off the allowlist —
  invalidates it immediately. No static API key in env.
- Secrets/config (`DISCORD_TOKEN`, `DISCORD_CLIENT_ID/SECRET`, `SESSION_SECRET`,
  `LARK_ALLOWED_USER_IDS`, `LARK_GUILD_ID`, optional `LARK_TARGET_LUFS`) live in the package's
  gitignored `.env` / `EnvironmentFile` (mode 0600), with a committed `.env.example`. **No root `.env`**
  (repo convention). Deck API keys are **not** in env — they live (hashed) in the DB, minted per user
  via the UI (D4/B26).
- **Follow-the-operator (D8/B1)** maps the actor to a Discord user ID — the web session's OAuth
  `identify` ID, or the **Discord user bound to the deck's API key** (D4) — then reads that user's
  voice channel from the bot's guild voice-state cache (`GuildVoiceStates` intent). No extra OAuth
  scope needed.
- **ToS note:** re-streaming copyrighted OST audio into a private campaign voice channel is a personal,
  closed-group use; document it, keep `yt-dlp` updatable, no public/multi-tenant distribution.

---

## 9. Deployment

Mirror eerie/mouth discipline exactly:

- **systemd user unit** `pkg/lark/deploy/lark.service` (`Type=simple`, `WorkingDirectory` = package
  dir, `ExecStart=…/bun run start`, `Restart=on-failure`, `EnvironmentFile=…/pkg/lark/.env`).
- **Resource limits**, but **more generous than eerie** — ffmpeg/Opus encode + downloads need CPU.
  Tune `CPUQuota`/`MemoryMax` so a spike can't starve `heart.iridi.cc` (the live wiki) yet voice stays
  glitch-free. Downloads niced below playback.
- **Caddy**: add `lark.iridi.cc { reverse_proxy localhost:<port> }` to the host's **gitignored**
  `sites.caddyfile` (manual host edit; the file embeds a Cloudflare token and isn't version-controlled).
- **Host prerequisites:** `yt-dlp` + `ffmpeg` on `PATH`; a **persistent data dir** (SQLite + audio
  files) that is **backed up** and **not** a build artifact (distinct from the gitignored `dist/`).
- **Build:** `bun run --filter @faerrin/lark build` → `dist/` (SPA), served by `server.ts`.
- `pkg/lark/deploy/DEPLOY.md` runbook (eerie-style), all host steps manual.

---

## 10. Non-functional requirements

- **Playback continuity:** voice underruns avoided; ingest never blocks the audio path (B24).
- **Storage growth:** audio accumulates; runbook covers disk monitoring and a retention/cleanup story
  (deleting a track frees its file).
- **Blast-radius isolation:** must never threaten `heart.iridi.cc` (shared host) — systemd limits.
- **Control latency:** Stream Deck round-trip < 200 ms for transport commands.
- **Testability (CI-safe):** the HTTP/library/tagging/bulk-rename logic is unit-tested **without** a
  live Discord connection, ffmpeg, or yt-dlp — exactly as eerie unit-tests its handler without OBS.
  See §11 CI gotcha.
- **Observability:** structured logs for voice state, job progress, command audit.

---

## 11. Risks, spikes, and gotchas

1. **[#1 RISK] Bun + `@discordjs/voice` (Phase 0 spike, do first).** Validate, under Bun: voice
   connect, native Opus encode (`@discordjs/opus`), encryption (`sodium-native`/`libsodium-wrappers`),
   UDP, and an ffmpeg pipe (`prism-media`). **Fallback if Bun can't:** run *only the bot* as a Node
   subprocess (keep server/UI on Bun) or revisit the Rust-songbird split (rejected option C). The spike
   gates everything; don't build the library UI before voice is proven.
2. **CI gotcha (Dagger `oven/bun` container).** The pinned CI container has **no** ffmpeg/yt-dlp and
   **native voice modules may not build**. lark's `test`/`typecheck` must pass there **without** those —
   gate any integration test behind an env flag (`LARK_INTEGRATION=1`), like eerie keeps its tests
   pure. Don't let voice/native deps break `bun --filter '*' test`/`typecheck` or the Dagger bun lane.
3. **yt-dlp fragility:** format changes, age/region gating, rate limits, breakage on YT updates → keep
   it updatable, surface per-item errors (`partial` jobs), never abort a whole playlist on one failure.
4. **ffmpeg/host binary drift:** check presence + version at startup; fail loudly with guidance.
5. **Separate bot identity:** lark needs its **own** Discord application + token (not mouth's), with
   voice intents/permissions; both bots coexist in the campaign guild.
6. **Audio loudness variance** across OSTs (jarring at the table) → **in scope and resolved (D5):**
   measure R128 on ingest, apply as live playback gain with a true-peak limiter (B25). Watch
   gain-up clipping and tracks with no measured value yet (fall back to 0 dB / unity).
7. **Restart semantics:** playback state is ephemeral (idle after restart) — accepted for
   single-operator use; document it so it isn't mistaken for a bug.
8. **Concurrent control desync** (web vs deck) → single engine + serialized commands (B9).

---

## 12. Out of scope / deferred (sensible defaults)

- **Video/screenshare** — out (D2).
- **Multi-guild / multi-tenant** — out (D3).
- **In-Discord slash-command control** — deferred (web + deck cover v1); easy to add later via the same
  engine.
- **Crossfade / gapless** — **explicitly a wanted future feature** (post-v1). v1 plays sequentially,
  but the playback engine **must be designed so crossfade/gapless can be added without a rewrite** —
  i.e. a lookahead/mixing-capable audio path (decode-ahead of the next track, a mix/fade stage), not a
  hard "stop one stream, start the next" boundary. Track this as a first-class roadmap item.
- **Loudness normalization** — **now in scope, not deferred** (see B25 / §11.6 / Q1).
- **FTS5 search / fuzzy search** — start with `LIKE`; upgrade if needed.
- **Cover art/thumbnails** (from YT) — nice-to-have.
- **Per-track volume / EQ**, **bulk-rename undo history** — deferred.

---

## 13. Open questions (non-blocking; defaults chosen)

All resolved with the user (2026-06-10) and promoted to the §1 decisions table:

| Q | Resolution |
|---|---|
| Audio storage format — keep source vs transcode on ingest? | **Keep source as-is** (D5); transcode-to-Opus happens **live in the playback chain**, where the loudness gain is also applied. No on-ingest re-encode. |
| Are collections strictly 1:1 with YT playlists, or also hand-built? | **Both** — a YT import seeds one collection; the operator can also create/curate collections manually (B15). |
| Should "stop" stay connected or leave? | **Stay connected, clear queue** (D6). |
| Debounce before auto-leave? | **60 s** (D7). |
| How is the voice channel chosen? | **Follow the operator's voice state**, explicit `channelId` overrides (D8). |

---

## 14. Implementation phasing (maps to Double Diamond Develop/Deliver)

- **Phase 0 — Voice spike (de-risk D1).** Bun PoC: connect to a voice channel, play a local OGG via
  `@discordjs/opus`+ffmpeg, leave. **Gate:** clean audio under Bun, else trigger the Node-subprocess
  fallback. *Exit criterion for the whole project's architecture.*
- **Phase 1 — Skeleton & auth.** Scaffold `pkg/lark` (scripts, `tsconfig.base` extend, deps declared);
  eerie-style `Bun.serve` with testable `handle()`; SQLite schema + migrations; Discord OAuth login +
  allowlist + session; API-key middleware; SPA shell (Vite+React, optional gothic skin).
- **Phase 2 — Library core.** tracks/collections/tags/playlists CRUD; **upload ingest** (B19); browse
  /filter UI (B11); **rename + bulk-rename (with preview) + bulk-tag** (B12–B14); delete (B18).
- **Phase 3 — YouTube ingest.** `yt-dlp` single (B20) + playlist enumerate/import (B21); download-job
  model + bounded worker pool (B24); **SSE progress UI** (B22); dedup (B23); **R128 loudness measured
  on ingest** for every track (upload + YT) (B25).
- **Phase 4 — Playback engine.** Voice join/leave (B1), play/stop/pause/skip/prev (B4–B7), queue, loop
  (B8), playlists, single-source serialization (B9), resilient skip (B10), **follow-the-operator join**
  + **60 s auto-leave** (B1/B2), reconnect (B3), **playback gain from measured LUFS + true-peak limiter**
  (B25, D5). **Engine designed crossfade/gapless-ready** (decode-ahead + mix/fade stage) even though
  crossfade ships post-v1 (§12).
- **Phase 5 — Stream Deck API.** The §7 control endpoints + `now-playing`; **web-UI API-key
  generation / list / revoke** bound to the logged-in user (B26) and the matching key-auth middleware
  (hash store, user resolution for follow-the-operator); a short endpoint reference doc for deck
  buttons.
- **Phase 6 — Deliver.** Unit tests (CI-safe, §11.2); `lark.service` + DEPLOY.md; `sites.caddyfile`
  route + host cutover (manual); `pkg/lark/CLAUDE.md`. Validate `bun --filter '*' typecheck|test`
  green; `dagger call check` green.

---

## 15. Acceptance (definition of done for v1)

Operator logs in at `lark.iridi.cc` (Discord OAuth, allowlisted), imports a YouTube OST playlist and
watches per-video download progress, bulk-renames the noisy titles and bulk-tags them `explore`/`calm`,
builds a playlist, and from a Stream Deck button **plays** it into a voice channel and **stops** it;
`now-playing` and **list-by-tag/album** endpoints return correct JSON; when the last human leaves the
channel lark stops and disconnects after the debounce; the whole workspace stays green and the service
runs under systemd behind Caddy without endangering `heart.iridi.cc`.
```
