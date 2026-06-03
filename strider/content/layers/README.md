# Layers

Layers are timestamped deltas describing how the map's named sub-regions
(bases, buildings, landmarks) change over time. They sit on top of the
faction-territory map computed in `src/lib/hexUtils.ts` and are folded in
chronological order to produce the current set of regions.

## File naming

`content/layers/{YYYY}-{MM}-{DD}T{HHMMSS}-{slug}.md` — the prefix is the
layer's timestamp, year zero-padded to 4 digits, time as `HHMMSS` (no
colons). Example: `0863-07-13T142100-hildebrant-base.md`. This keeps the
on-disk file order in chronological order automatically — adding an
earlier-dated layer just sorts in front without renumbering anything.

The frontmatter `timestamp` field is still the canonical source for the
fold's sort key; the filename prefix is a redundant copy chosen so that
`ls content/layers/` and the fold agree.

## Schema

```yaml
---
timestamp: "2026-05-22T14:30:00Z" # ISO-8601, required
message: "Short log line for this event."
changes:
  - op: add
    slug: alkahest-hq # unique per region, kebab-case
    name: "Alkahest HQ"
    faction: alkahest-freight # faction slug
    hexes:
      - [16, -27]
      - [17, -27]

  - op: update
    slug: tinkers-row
    name: "Tinker's Row (Expanded)" # any subset of name/faction/hexes
    # omitted fields stay unchanged

  - op: remove
    slug: old-warehouse
---
Optional body prose — surfaced later in the timeline UI.
```

## Ops (session 1)

- `add` — requires `slug`, `name`, `faction`, `hexes`. Errors if slug already exists.
- `update` — requires `slug`; any subset of `name`, `faction`, `hexes` replaces those fields. Errors if slug missing.
- `remove` — requires `slug`. Errors if slug missing.

All errors throw at module-load time so authoring mistakes fail loudly in dev.

## Skein ops

The Skein is a separate overlay (toggleable via the auspex strip) whose
"regions" are single hexes carrying a symbol, optionally joined by amber
network lines. Skein regions are distinct from the regions above — they
share the layer file but never collide with region slugs.

- `skein-add` — requires `slug`, `name`, `faction`, `hex` (single `[q, r]` pair, **not** `hexes`), and `symbol` (path under `public/`, e.g. `symbols/foo.svg`). Errors if slug already exists.
- `skein-update` — requires `slug`; any subset of `name`, `faction`, `hex`, `symbol` replaces those fields. Errors if slug missing.
- `skein-remove` — requires `slug`. Errors if slug missing. Connections referencing the removed slug remain but are skipped at render time.
- `skein-connect` — requires `from` and `to` (Skein region slugs). The pair is canonicalized (`a↔b` and `b↔a` dedupe). Errors if `from === to`.
- `skein-disconnect` — requires `from` and `to`. Errors if the pair isn't currently connected.

Example:

```yaml
changes:
  - op: skein-add
    slug: signal-relay
    name: "Signal Relay"
    faction: alkahest-freight
    hex: [16, -27]
    symbol: symbols/signal-relay.svg

  - op: skein-add
    slug: dead-drop
    name: "Dead Drop"
    faction: necrolog
    hex: [-12, 22]
    symbol: symbols/dead-drop.svg

  - op: skein-connect
    from: signal-relay
    to: dead-drop
```

## Authoring with the editor

The `/editor` page provides a click-to-pick UI that writes a new layer file for
you. It needs a sidecar Bun script running on `127.0.0.1:3001` to perform the
write (the production site is statically exported and has no server).

In one terminal:

```bash
bun dev
```

In a second terminal:

```bash
bun run editor:server
```

Then open <http://localhost:3000/editor>. Saving a layer POSTs to the sidecar
which writes the new file under `content/layers/`. The sidecar refuses to
overwrite existing files; if you need to revise a layer, edit the markdown
directly or write a follow-up layer with an `update` / `remove` change.

Toggle the **REGION** / **SKEIN** kind at the top of the panel to switch
between authoring kinds. The editor handles `add`/`update`/`remove` for
regions and `skein-add`/`skein-connect`/`skein-remove` for the Skein.
`skein-update` and `skein-disconnect` are written by hand — they're rare
enough not to warrant their own UI.

## Out of scope (for now)

Hex-to-faction ownership changes are not yet a layer op — the Voronoi
assignment in `src/lib/hexUtils.ts` is still the source of truth for which
faction owns which hex. The schema is intentionally forward-compatible so
ownership ops can be added later without breaking existing layers.
