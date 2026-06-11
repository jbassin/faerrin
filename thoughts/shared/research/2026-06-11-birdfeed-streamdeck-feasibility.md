---
date: 2026-06-11
topic: "birdfeed — Stream Deck plugin for lark: feasibility + architecture"
status: research-complete (no code written)
related:
  - pkg/lark (the control surface)
  - thoughts/shared/memory/lark-discord-music-bot-spec.md
---

# birdfeed — Stream Deck plugin for `lark`: feasibility findings

**Question asked:** Is it possible to build a Stream Deck plugin (`@faerrin/birdfeed`) that drills
`lark → collection → tag`, where pressing a collection shows a grid of colored-tag buttons, pressing
a tag shows the tracks for that collection+tag on the left with quick-jump tag buttons on the right,
and the currently-playing track is visibly indicated on its button?

**Verdict: Yes — all of it is achievable.** With **one important reframe**: the "open a folder"
mental model is *not* how Stream Deck plugins work. There is **no plugin API for Stream Deck folders**,
and bundled "profiles" are static, pre-authored layouts that can't be generated from dynamic library
data. The drill-down must be a **plugin-managed navigation state machine that redraws keys in place** —
which gives you *more* power than folders (fully data-driven, live now-playing), not less.

---

## 1. How a Stream Deck plugin actually runs (the foundation)

- A plugin is a **plain Node.js process** the Stream Deck desktop app launches. It opens a **WebSocket
  to `localhost:<port>`**, sends a registration handshake, and from then on drives keys / receives
  events over that socket. The official `@elgato/streamdeck` TS SDK wraps this (`streamDeck.connect()`).
- **Bundled Node runtime is pinned to v20 or v24** via the manifest `Nodejs.Version` field. Otherwise
  it's a full Node runtime.
- **Outbound network I/O is unrestricted** — there is no documented sandbox. The plugin can freely make
  HTTP calls to a separate local/remote service. **This is exactly the lark integration pattern: the
  birdfeed plugin process is a thin client that calls lark's HTTP API.**
- Scaffolding/dev loop via `@elgato/cli`: `streamdeck create` (scaffolds a TS plugin), `streamdeck link`,
  `streamdeck restart`, `streamdeck dev` (watch/build).

## 2. What the SDK supports (capability matrix)

| Need | Supported? | Exact API | Caveats |
|---|---|---|---|
| Set a key's image at runtime | ✅ | `action.setImage(image?, {target, state})` | Accepts a **raw SVG string**, a base64 data-URI (PNG/JPEG/WEBP), or a plugin-relative file path. **No GIF/animation.** Keys are 72×72 (auto-resized). Ignored if the user set a custom icon on that key. |
| Set a key's title at runtime | ✅ | `action.setTitle(title?, {target, state})` | `target` = Hardware / Software / both. |
| Binary play/pause glyph | ✅ | manifest `States` (max **2**) + `action.setState(0\|1)` | Only 2 states — fine for play/pause, **not** enough to encode per-track now-playing; use `setImage` for that. |
| Know which keys are on screen | ✅ | `onWillAppear` / `onWillDisappear` | Payload carries a **stable `context` id** + `coordinates {column,row}` + `controller`. SDK keeps a live `streamDeck.actions` store (`getActionById`). This is how you push updates only to *visible* track buttons. |
| Per-key persisted config | ✅ | `action.getSettings()/setSettings()`; plugin-wide `getGlobalSettings()/setGlobalSettings()` | Store "which track/tag this slot currently represents", and global nav state. |
| Device grid size / type | ✅ | `streamDeck.devices` → `{type, size:{columns, rows}}`, `onDeviceDidConnect/DidChange` | Adapt the left/right split + pagination to the real hardware. |
| Programmatic profile switch | ✅ | `streamDeck.profiles.switchToProfile(deviceId, profileName?, page?)` | `deviceId` is **first**; omit name → switch back to the user's prior profile; `page` needs SD 6.5. |
| Stream Deck + dials/touch | ✅ | `onDialRotate/onDialDown/onTouchTap`, `action.setFeedback/setFeedbackLayout` | Optional — nice for a volume/scrub dial later. |

### The two hard limitations that shape the design
1. **No dynamic folders, no dynamic profile contents.** Folders are a user-only UI concept with no SDK.
   `.streamDeckProfile` files are **static, pre-authored** and fixed at install time — you cannot
   generate "one profile per collection/tag" at runtime. A plugin can **only switch to its own bundled
   profiles**, never user profiles.
2. **`setImage` has no documented rate limit, but it's WebSocket round-trips** — treat now-playing as
   *event-driven, low-frequency* redraws (a few/sec), not smooth animation. Pre-render frames if you
   ever want a pulse/EQ effect.

**Consequence:** drive everything with a small fixed set of **action "slots"** painted at runtime via
`setImage`/`setTitle`/`setSettings`, with your own in-memory "folder" navigation — *not* profile
switching. (A single bundled profile is optional, only to pre-place the slot grid + a fixed
left/right split; even that is better computed from `device.size`.)

## 3. What lark already gives us (the control surface)

lark exposes a **real HTTP REST API** (not just a UI helper) at `https://lark.iridi.cc`
(local dev `http://localhost:8788`), all under `/api/v1/`. **Auth:** an API key minted once in the lark
web UI, sent as `Authorization: Bearer lark_…` (or `X-Lark-Key`). A key is bound to a Discord user.

Endpoints birdfeed needs:

| Purpose | Endpoint |
|---|---|
| List collections | `GET /api/v1/collections` → `Collection[]` |
| List tags (with colors + counts) | `GET /api/v1/tags` → `(Tag & {track_count})[]` |
| Tracks in a collection+tag | `GET /api/v1/tracks?collection=<id>&tag=<id>` → `TrackWithTags[]` (filters combine; each track carries its `tags: Tag[]` inline) |
| Play | `POST /api/v1/playback/play` `{trackId \| trackIds \| collectionId \| playlistId, channelId?}` → `NowPlaying` |
| Transport | `POST /api/v1/playback/{pause,resume,stop,next,prev}` → each returns `NowPlaying` |
| **Now playing** | `GET /api/v1/playback/now` → `NowPlaying` |

**`NowPlaying` shape** (`pkg/lark/src/bot/playback.ts:18`):
```ts
{ connected, channelId, status:"idle"|"playing"|"paused", loopMode,
  current: { trackId, title, positionMs, durationMs } | null,
  queueLength, queueIndex }
```

**Tag color** = `Tag.color`, a `#rrggbb` hex string or `null`. The web UI offers an 8-swatch palette
(Crimson/Amber/Sage/Teal/Azure/Violet/Rose/Slate) but the API accepts any valid hex. **`current.trackId`
is the join key** for highlighting the playing track on its button.

### Two gotchas from lark's side
- **No push for playback state.** There is **no SSE/WebSocket for now-playing** (SSE exists only for
  ingest job progress). The web client **polls `GET /playback/now` every 2500 ms** — birdfeed must do
  the same. (2.5 s latency on the now-playing highlight is the realistic expectation.)
- **Playback is voice-channel-bound and single-guild.** `play` resolves the target voice channel from
  the **key owner's current Discord voice state**; if the operator isn't in a channel and no `channelId`
  is supplied you get **`409`**. `503` if the bot has no token configured. So: the host must be in a
  Discord voice channel for play to work (or birdfeed sends an explicit `channelId` / first calls
  `POST /api/v1/voice/join`).

## 4. Recommended architecture

**Strategy: a single plugin-managed navigation state machine; data-driven key redraws; HTTP client to
lark; poll for now-playing.** No profile switching for the dynamic content.

```
Stream Deck app ──WS──> birdfeed (Node plugin process) ──HTTPS Bearer──> lark /api/v1
                                   │
                                   ├─ NavState per deviceId: {level: root|collection|tag, collectionId?, tagId?, page}
                                   ├─ slot map: Map<context, {col,row, meaning}>  (built from willAppear)
                                   └─ poll GET /playback/now @2.5s → highlight visible track slot
```

- **One workhorse action** `com.faerrin.birdfeed.slot`, placed across the key grid (ship a bundled
  profile that pre-fills the grid with slots, or let the user drop them). Each slot learns its
  `coordinates` from `willAppear`; the plugin paints meaning into it based on current `NavState`.
- **Root level:** fetch `GET /collections`, paint each visible slot as a collection (title +
  generated SVG). Reserve one slot as the lark "home" entry if desired.
- **Collection level:** on a collection keyDown, set `NavState.level=collection`; fetch `GET /tags`
  (optionally narrowed to tags present in that collection), paint each slot as a **colored swatch**
  using an **SVG data-URI filled with `Tag.color`** + the tag name.
- **Tag level:** on a tag keyDown, set `level=tag`; fetch `GET /tracks?collection&tag`. Compute the grid
  from `device.size.columns`: **rightmost column = tag quick-nav** (one key per sibling tag, colored),
  **remaining left columns = track buttons**, and a dedicated **Back** key. Paginate when tracks exceed
  the available left slots (a "more" key advances `NavState.page`).
- **Now-playing highlight:** poll `GET /playback/now`; when `current.trackId` matches a visible track
  slot's track id, repaint that slot's SVG with a highlight (border/glow) and update a global
  play/pause `setState`. Only repaint slots currently in the live `streamDeck.actions` store.
- **Back / nav stack:** the SDK has no page-stack primitive — keep `NavState` per device and pop it on
  the Back key, then redraw. (If you later add bundled profiles for fixed layouts, each can carry a hard
  Back key and `switchToProfile(deviceId, undefined)` returns to the user's profile.)
- **Settings:** persist the active collection/tag/page in `globalSettings`; persist per-slot meaning via
  `setSettings` so a key restores correctly after `willAppear`.

### Monorepo fit (Bun workspace)
- New `pkg/birdfeed` (`@faerrin/birdfeed`), a `*.sdPlugin` Node plugin built with `@elgato/cli` + the
  TS SDK. It's a **separate process from lark** and talks to it purely over HTTP — no runtime coupling.
- lark's types are **not published as an importable surface** (no `exports`), so either (a) duplicate the
  small shapes (`NowPlaying`, `Tag`, `Collection`, `TrackWithTags`) in birdfeed, or (b) reference them
  as a workspace dep. Canonical sources: `pkg/lark/src/bot/playback.ts:18` (`NowPlaying`),
  `pkg/lark/src/db/repo.ts:8-55` (full rows), `pkg/lark/src/web/types.ts` (web subset),
  `pkg/lark/src/web/grouping.ts` (the 8-swatch palette + color-grouping logic to mirror).
- Note the SDK runtime is **Node 20/24**, not Bun — birdfeed is a Node plugin even though the repo is
  Bun-first. It builds/ships via `@elgato/cli`, like `mouth`/`gothic` sit outside the bun script lanes.

## 5. Open decisions (for the Define phase)
1. **Where does the lark base URL + API key come from?** Property Inspector config UI vs. global settings
   vs. env. (Recommend a small Property Inspector to paste the `lark_…` key + origin.)
2. **Channel handling:** rely on "follow the operator" (host must be in voice) or add an explicit
   "join channel" key? `409` handling needs a visible error state on the key.
3. **Tag list per collection:** `GET /tags` is global; do we filter to tags actually present in the
   chosen collection (needs client-side filtering of `GET /tracks?collection=X`, or a small lark API
   addition)?
4. **Device targets:** support standard (5×3) + XL (8×4) + maybe Plus dials. The left/right split must be
   size-aware.
5. **Bundled profile vs. pure redraw** for the slot grid (recommend: ship one profile that pre-places
   slots so the user doesn't have to, but keep all content dynamic).

## Sources
- Stream Deck SDK docs: https://docs.elgato.com/streamdeck/sdk/ (profiles, keys, actions, devices,
  dials guides; manifest + websocket references; CLI)
- SDK source: https://github.com/elgatosf/streamdeck (`profiles.ts`, `actions/key.ts`, `api/command.ts`,
  `api/events/action.ts`, `actions/store.ts`)
- lark control surface (this repo): `pkg/lark/src/server/routes/{playback,library,keys}.ts`,
  `pkg/lark/src/bot/playback.ts`, `pkg/lark/src/db/schema.ts` + `repo.ts`, `pkg/lark/docs/stream-deck.md`,
  `pkg/lark/src/web/{playbackState.tsx,grouping.ts,types.ts}`
