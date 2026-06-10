# eerie — deploy / OBS runbook

Take the dice-roll overlay live as a **systemd user service** on the same host that runs
aether/Caddy + mouth, isolated so it can never threaten `heart.iridi.cc`. Mirrors mouth's
deploy discipline (bare systemd user unit, no container; config via `EnvironmentFile`). All
host steps are **manual** — nothing here runs automatically.

Plan of record: `thoughts/eerie/plans/0001-obs-overlay.md`.

## What eerie is

One Bun process (`server.ts`) doing three jobs on a single port (default `8787`):

- `POST /api/v1/roll` — authenticated ingest (`X-Eerie-Token`) from `@faerrin/mouth`.
- `GET /feed` — SSE stream fanning each roll out to every connected OBS Browser Source.
- `GET /*` — serves the built overlay (`dist/`).

## 0. Prerequisites (host)

- Bun (already on the dev host at `/home/jbassin/.bun/bin/bun`).
- A secret for the ingest token. Generate one: `openssl rand -hex 32`.
- Access to the host's **gitignored** `sites.caddyfile` (it embeds the Cloudflare DNS token).

## 1. Build the overlay (produces `dist/`)

```sh
cd /ruby/data/experiments/faerrin
bun install
bun run --filter @faerrin/eerie build      # → pkg/eerie/dist/
```

`dist/` is gitignored; it's a build artifact the server serves. Rebuild after any UI change.

## 2. Configure (`.env`, mode 0600, NOT in git)

```sh
cp pkg/eerie/.env.example pkg/eerie/.env
chmod 600 pkg/eerie/.env
# then edit:
#   PORT=8787
#   EERIE_TOKEN=<the openssl rand -hex 32 value>
```

## 3. DNS + Caddy (new host `eerie.iridi.cc`)

Add a DNS record for `eerie.iridi.cc` (Cloudflare), then a block to the host's gitignored
`sites.caddyfile` (alongside `heart.iridi.cc` / `caster.iridi.cc` / `strider.iridi.cc`):

```caddy
eerie.iridi.cc {
	# SSE must not be buffered — stream roll events straight through.
	reverse_proxy 127.0.0.1:8787 {
		flush_interval -1
	}
}
```

`flush_interval -1` disables response buffering so the `text/event-stream` reaches OBS
immediately. Reload Caddy after editing.

## 4. Install + enable the service

```sh
cp pkg/eerie/deploy/eerie.service ~/.config/systemd/user/eerie.service
loginctl enable-linger "$USER"           # already enabled for mouth — harmless to repeat
systemctl --user daemon-reload
systemctl --user enable --now eerie.service
systemctl --user status eerie.service
journalctl --user -u eerie.service -f    # watch logs
```

Smoke-test the ingest from the host (expect 204 with the token, 401 without):

```sh
curl -s -o /dev/null -w '%{http_code}\n' -XPOST https://eerie.iridi.cc/api/v1/roll \
  -H 'content-type: application/json' -H "x-eerie-token: $EERIE_TOKEN" \
  -d '{"v":1,"user":"Smoke","expression":"1d20","total":20,"is_crit":true,"is_fumble":false}'
```

## 5. Point mouth at eerie

In mouth's env (systemd `EnvironmentFile`, e.g. `pkg/mouth/.env`):

```sh
FEED_WS_URL=https://eerie.iridi.cc/api/v1/roll
EERIE_TOKEN=<same secret as eerie's .env>
```

Restart mouth (`systemctl --user restart mouth.service`). The broadcast is **best-effort**, so
a momentary eerie outage never breaks a roll.

## 6. OBS Browser Source

Add a **Browser Source** in OBS:

- **URL:** `https://eerie.iridi.cc/`
- **Width × Height:** `1920 × 1080` (the overlay is transparent; OBS scales/positions it).
- Tick **"Shutdown source when not visible"** off if you want it to keep its SSE connection
  warm; the client auto-reconnects either way.

The ticker anchors bottom-left. Roll a few dice in Discord (including a nat-20 / nat-1) and
confirm rows appear with crit (teal glow) / fumble (wax-red) fx.

## Notes

- The overlay degrades gracefully on the **v0** mouth payload (`{user,value,is_crit,is_fumble}`)
  — eerie fills `expression`/`ts` defaults. mouth now sends the **v1** payload (adds `expression`,
  `total`). Individual die faces (`dice[]`) remain a deferred stretch.
- This is the **only** eerie endpoint exposed publicly. The ingest is guarded by `X-Eerie-Token`;
  keep the secret out of git and rotate it if leaked.
