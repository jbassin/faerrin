# 0001 — `@faerrin/eerie`: the dice-roll OBS overlay (rebuild)

**Status:** IMPLEMENTED (Phases A–F landed on `main`, 2026-06-09). Remaining work is the
**manual host cutover** in `pkg/eerie/deploy/DEPLOY.md` (DNS + Caddy block + systemd + OBS) —
those steps need host access and the gitignored `sites.caddyfile`, so they can't be automated.
**Created:** 2026-06-09
**Author:** octo:plan → octo:embrace (Claude-only, team mode)
**Package:** `pkg/eerie` → `@faerrin/eerie`

Rebuild the decommissioned live dice-feed OBS overlay from scratch as a Bun-workspace
member. `pkg/mouth` (the Rust Discord dice bot) broadcasts every roll; `eerie` ingests
that broadcast, fans it out to a browser page in real time, and renders animated dice
that OBS captures as a Browser Source.

---

## 1. Decisions locked in this plan

| Fork | Choice | Why |
|------|--------|-----|
| **Render stack** | **Vite + React 19 + pixi.js 8** | WebGL particle/shader spectacle for crits/fumbles; reuses strider's exact stack & know-how; consumes `@faerrin/gothic` skin. |
| **Transport** | **SSE (Server-Sent Events)** | Feed is strictly one-way (server→browser). `EventSource` auto-reconnects — critical for an unattended OBS source. No handshake, no deps, passes cleanly through Caddy. |
| **Contract** | **Redesign payload + endpoint (versioned)** | Richer payload (expression, dice faces, modifier, total, timestamp) lets the overlay show the *whole* roll and drive per-die face animations — not just a bare total. Requires a coordinated Rust change to mouth. |
| **Host** | **New `eerie.iridi.cc`** | Honest name (it's SSE, not ws); clean Caddy block; room for `/admin`. Costs a one-line `mouth/.env` change + a new Caddy block. |
| **Overlay scope** | **Running ticker / recent history** | Last N rolls stacked, newest highlighted (crit/fumble badge). Shows momentum; fx must not fight the list. |
| **Crit rule** | **Mirror mouth's `RollGoodness`** | eerie is a dumb renderer — reads `is_crit`/`is_fumble` verbatim. Single source of truth, no rule drift. |
| **Ingest auth** | **`X-Eerie-Token` shared secret** | mouth sends the header; eerie 401s without it. Stops randos spamming fake rolls onto the live stream. |

These were chosen interactively. The redesign is the only choice that touches a second
package (mouth/Rust) — see §6 for the lockstep risk and rollback.

---

## 2. The contract being replaced

Today `pkg/mouth` (`crates/discord/src/handler.rs:562-604`) does a **best-effort** HTTP
POST on every roll to `FEED_WS_URL` (`.env`: `https://feed-ws.iridi.cc/broadcast/roll`):

```jsonc
// current payload (handler.rs)
{ "user": "<player_name>", "value": <int>, "is_crit": <bool>, "is_fumble": <bool> }
```

- Fire-and-forget: failures are logged and skipped (commit `ea1ba69`), so a down overlay
  never breaks rolls. **eerie inherits this guarantee — mouth must never block on us.**
- The roll object at the broadcast point exposes more than is currently sent:
  - `roll.text()` → rendered expression (e.g. `2d6+3`)
  - `roll.value()` → total (`isize`)
  - `RollGoodness` (Crit / Fumble / normal) via `(&roll).into()`
  - `DieRes` / the `Roll` enum can yield individual die faces with deeper traversal
    (the **stretch** field — see §6).

### Redesigned payload (`POST /api/v1/roll`)

```jsonc
{
  "v": 1,                       // schema version
  "user": "Faerrin",            // profile.player_name (existing)
  "expression": "2d6+3",        // roll.text()
  "total": 12,                  // roll.value()
  "dice": [4, 5],               // individual faces — STRETCH (needs Roll traversal)
  "modifier": 3,                // STRETCH (derive from expression/Roll)
  "is_crit": false,             // existing
  "is_fumble": false,           // existing
  "ts": "2026-06-09T21:48:01Z"  // server-side ok; client can stamp on ingest
}
```

**Phasing:** `/api/v1/roll` accepts *both* shapes. **Go-live (v0)** = mouth's existing four
fields POSTed to the new `eerie.iridi.cc/api/v1/roll` URL with the `X-Eerie-Token` header —
so mouth's *only* required change to go live is the `.env` URL one-liner plus adding the auth
header. The richer fields (`expression`/`total`/`ts`, then `dice`/`modifier`) land as a
*separate, later* mouth Rust edit (Phase E). eerie's ingest validates with a Zod-ish schema
and fills defaults, so the overlay renders correctly against either shape and neither side is
ever blocked.

---

## 3. Architecture — one Bun process, three jobs

```
  ┌─────────────┐   POST /api/v1/roll        ┌──────────────────────────┐
  │  pkg/mouth  │ ─────────────────────────► │      @faerrin/eerie      │
  │ (Rust bot)  │   {user,expression,...}    │       server.ts          │
  └─────────────┘   best-effort, 1-way        │  ┌────────────────────┐  │
                                              │  │ 1. ingest (POST)   │  │
                                              │  │    validate+queue  │  │
                                              │  ├────────────────────┤  │
        OBS Browser Source                    │  │ 2. SSE hub /feed   │  │
   ┌──────────────────────┐   GET /feed (SSE) │  │    fan-out to N     │ │
   │  index.html (dist/)  │ ◄─────────────────│  │    EventSource cxns │ │
   │  React + pixi.js     │   text/event-stream│ ├────────────────────┤  │
   │  DieReveal / fx       │                  │  │ 3. static dist/    │  │
   └──────────────────────┘   GET / (static)  │  │    serve built page│  │
                              ◄───────────────│  └────────────────────┘  │
                                              └──────────────────────────┘
```

Single `Bun.serve` process. No external runtime deps for the server — Bun gives HTTP +
streaming responses natively. SSE is just a `text/event-stream` `Response` with a
`ReadableStream`; the hub keeps a `Set<controller>` and writes `data: <json>\n\n` to each.

### Why not a framework for the server?
Pure `Bun.serve` covers three routes (`POST /api/v1/roll`, `GET /feed`, static `dist/*`).
Adding Hono buys little here. **Decision: pure `Bun.serve`**, revisit only if routes grow.

---

## 4. Package layout

```
pkg/eerie/
  package.json            # @faerrin/eerie; deps: react, react-dom, pixi.js, @faerrin/gothic
  tsconfig.json           # extends ../../tsconfig.base.json
  vite.config.ts          # @vitejs/plugin-react; build → dist/
  index.html              # OBS Browser Source target (transparent bg)
  eslint.config.js        # flat config, mirror strider (declare @eslint/js!)
  CLAUDE.md               # local package guidance (per repo convention)
  .env.example            # PORT=8787, INGEST_TOKEN=...
  server.ts               # Bun.serve: ingest + SSE hub + serve dist/
  src/
    main.tsx              # React root mount
    Overlay.tsx           # EventSource subscription + ticker state (last N, newest first)
    RollRow.tsx           # one ticker row: name, expression, faces, total, crit/fumble badge
    feed.ts               # SSE client w/ reconnect + typed RollEvent
    schema.ts             # RollEvent type + runtime validation (shared w/ server)
    fx/
      crit.ts             # pixi.js particle burst (nat 20 / crit)
      fumble.ts           # pixi.js shatter/desaturate (nat 1 / fumble)
      stage.ts            # pixi Application lifecycle, transparent canvas
    overlay.css           # layout + @keyframes; imports @faerrin/gothic
  test/
    schema.test.ts        # payload validation (both v0 + v1 shapes)
    hub.test.ts           # SSE fan-out: N subscribers all receive an event
```

### `package.json` scripts (match repo conventions — Bun, root fan-out)
```jsonc
{
  "name": "@faerrin/eerie",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",                         // overlay hot-reload
    "dev:server": "bun run --hot server.ts",   // ingest+SSE hot-reload
    "build": "vite build",                     // → dist/ (OBS loads this)
    "start": "bun run server.ts",              // prod: serve dist/ + ingest + SSE
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "eslint .",
    "format": "prettier --write ."
  }
}
```
- Root scripts (`bun --filter '*' <x>`) pick these up automatically — **don't** re-implement
  vite build at the root (relative `outDir` would break, per CLAUDE.md).
- `@faerrin/gothic` via `workspace:*` for the amber/teal skin (fonts + `tokens.css`).
- Declare **every** import (hoisting hides phantom deps — bit strider twice).

---

## 5. Implementation phases (DEVELOP)

### Phase A — Scaffold + green workspace (no behavior yet)
1. `pkg/eerie/` skeleton: `package.json`, `tsconfig.json` (extends base), `vite.config.ts`,
   `index.html`, flat `eslint.config.js`, local `CLAUDE.md`, `.env.example`.
2. `bun install` at root; confirm `bun --filter '*' typecheck && test && lint` stays green.
3. **Gate:** whole workspace green with an empty-but-valid package.

### Phase B — Server: ingest + SSE hub (headless, testable)
1. `schema.ts`: `RollEvent` type + `parseRollEvent()` tolerant validator (accepts v0 four-field
   *and* v1 rich shape; fills defaults; rejects garbage with 400).
2. `server.ts`:
   - `POST /api/v1/roll` → **require `X-Eerie-Token` header (401 otherwise)** → validate →
     push to hub. Accepts both v0 (4-field) and v1 (rich) bodies.
   - `GET /feed` → `text/event-stream` SSE; register controller in hub `Set`; heartbeat
     comment every ~15s to keep Caddy/OBS from idling the connection; clean up on close.
   - `GET /*` → serve `dist/` (built overlay), with no-cache on `index.html`.
3. Tests: `schema.test.ts` (both shapes), `hub.test.ts` (N EventSource subscribers all get
   the event; disconnect removes controller; malformed POST → 400).
4. **Manual check:** `curl -N localhost:8787/feed` in one shell, `curl -XPOST .../api/v1/roll`
   in another → event appears. **Gate:** server proven before any UI.

### Phase C — Overlay UI (React) + feed wiring
1. `feed.ts`: typed `EventSource` client with auto-reconnect/backoff, exposes a subscribe fn.
2. `Overlay.tsx`: subscribe; keep a **ticker** of the last N rolls (newest first), animate
   new rows in at the top, age/fade older ones out. Transparent background for OBS.
3. `RollRow.tsx`: player name, expression, individual faces (when present), total, crit/fumble
   badge; pull colors/fonts from `@faerrin/gothic` tokens (`--accent` teal, `--accent-amber`).
4. CSS `@keyframes` baseline animation (works even before pixi fx land).
5. **Gate:** `bun run dev` + `dev:server`, POST a roll, see it render in a browser.

### Phase D — pixi.js fx polish
1. `fx/stage.ts`: transparent pixi `Application` overlaid on the React DOM (or pixi as the
   canvas layer behind DOM text). Confirm alpha compositing reads transparent in OBS.
2. `fx/crit.ts`: particle burst / phosphor bloom on `is_crit`.
3. `fx/fumble.ts`: shatter / desaturate / shake on `is_fumble`.
4. Performance: cap particle counts, dispose pixi objects per roll (no leak over a session).
5. **Gate:** crit and fumble each trigger their effect; idle overlay is a transparent no-op.

### Phase E — mouth Rust change (the contract redesign — see §6)
1. Edit `crates/discord/src/handler.rs` broadcast block: build the richer `json!` (add
   `expression: roll.text()`, `total: roll.value()`, `ts`, `v: 1`), keep `is_crit/is_fumble`.
2. **Stretch:** traverse `Roll`/`DieRes` to emit `dice: [...]` faces + `modifier`.
3. `mouth/.env`: set `FEED_WS_URL=https://eerie.iridi.cc/api/v1/roll` and add the
   `X-Eerie-Token` header to the reqwest POST; keep it best-effort.
4. Rebuild via the Dagger rust lane; deploy mouth. **Gate:** real Discord roll → overlay.

> Note: mouth's `.env` URL repoint + auth header is actually needed at **go-live** (Phase F),
> not just here — Phase E is specifically the *payload-shape* Rust edit (richer json!).

### Phase F — Deploy + OBS integration (DELIVER)
1. Caddy: new block `eerie.iridi.cc` → eerie's port in the host's `sites.caddyfile`
   (gitignored, edited on host — per CLAUDE.md). Add DNS for the subdomain.
2. systemd unit for `bun run start` (mirror `pkg/mouth/deploy/mouth.service`).
3. OBS: add Browser Source → eerie URL, transparent, matched canvas size; document in CLAUDE.md.
4. **Gate:** end-to-end on the live host; reconnect survives OBS source refresh.

---

## 6. Risks & mitigations

- **Two-package lockstep (mouth Rust ↔ eerie).** The redesigned contract is the one choice
  that edits a live Rust bot. *Mitigation:* eerie ships **first**, accepting the existing v0
  payload (zero mouth change) so it's live and proven; the mouth change is a later, isolated
  commit. Broadcast stays best-effort, so even a botched eerie deploy can't break rolls.
  *Rollback:* revert the one `handler.rs` json block; eerie keeps accepting v0.
- **`dice`/`modifier` faces may be non-trivial to extract** from the `Roll` enum. *Mitigation:*
  they're explicitly **stretch** fields; v1 ships with `expression`+`total` (already on the
  struct) and the UI degrades gracefully when `dice` is absent.
- **OBS transparency / pixi compositing.** WebGL alpha over DOM can render black in some OBS
  configs. *Mitigation:* validated in Phase D gate before deploy; CSS-keyframe baseline (Phase
  C) is a working fallback if pixi compositing fights OBS.
- **SSE through Caddy idling out.** *Mitigation:* heartbeat comments every ~15s; `EventSource`
  auto-reconnect covers drops.
- **Phantom deps from hoisting.** *Mitigation:* declare react/react-dom/pixi.js/@eslint/js
  explicitly (learned the hard way in strider).
- **jj, not git.** All VCS via the `jj` skill; never raw `git` (can corrupt jj state).

---

## 7. Effort & sequencing

| Phase | Scope | Rough size |
|-------|-------|-----------|
| A | Scaffold, green workspace | S |
| B | Server: ingest + SSE hub + tests | M |
| C | React overlay + feed wiring | M |
| D | pixi.js crit/fumble fx | M–L (visual polish open-ended) |
| E | mouth Rust payload redesign | S (rich) / M (with dice faces) |
| F | Caddy + systemd + OBS deploy | S–M |

**Recommended order:** A → B → C → F(partial, v0 live) → D → E. Get a *working overlay on the
existing v0 contract* deployed early (A–C+F), then layer pixi spectacle (D) and the richer
mouth payload (E) without pressure. This front-loads a usable result and isolates the risky
cross-package Rust change to the end.

---

## 8. Persona team (Claude-only, team mode) for execution

- **backend-architect** — server.ts ingest/SSE hub design, schema versioning, mouth contract.
- **frontend-developer** — React overlay, queueing/scheduler, feed client/reconnect.
- **ui-ux-designer** — gothic-skinned dice reveal, crit/fumble visual language, OBS framing.
- **octo:code-reviewer** — gate reviews at each phase boundary.

(No other LLM providers — repo is Claude-only by design; personas provide the diversity.)

---

## 9. Resolved decisions (was: open questions)

1. **Host → new `eerie.iridi.cc`.** New Caddy block + DNS; `mouth/.env` `FEED_WS_URL` repoints
   to `https://eerie.iridi.cc/api/v1/roll` at go-live.
2. **Overlay scope → running ticker / recent history.** Last N rolls, newest first, with
   crit/fumble badges; pixi fx layered so they don't fight the list.
3. **Crit/fumble → mirror mouth's `RollGoodness`.** eerie reads `is_crit`/`is_fumble` verbatim;
   no rule logic in the overlay (single source of truth).
4. **Auth → `X-Eerie-Token` shared secret.** mouth sends the header; eerie 401s without it.
   Secret in each package's gitignored `.env`.

### Remaining smaller calls (sensible defaults, change on request)
- **Ticker depth N** — default **6** visible rows.
- **Row dwell/fade** — newest highlighted ~4s, then dim; rows age out as new ones arrive.
- **Canvas size** — default **1920×1080 transparent** (OBS scales the source).
