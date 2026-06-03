# `content/layers/` — authoring layer files

Each file is one event in the timeline. Filename order = chronological order; the build sorts by `timestamp` first, then by slug.

## Filename

Strict regex (enforced by `scripts/editor-server.ts`, also validated at parse time in `scripts/build-content.ts`):

```
^\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9-]+\.md$
```

i.e. `0863-07-18T200001-garrick-textiles-falls-fallow.md`. Lowercase kebab-case slug, six-digit `HHMMSS` (no colons). The in-world year is 4-digit (e.g. `0863`) — keep zero-padding.

Don't hand-write a colliding filename — the editor sidecar rejects existing files with HTTP 409.

## Frontmatter

```yaml
---
timestamp: "0863-07-18T20:00:01Z" # ISO-ish; the build only requires it be a string
message: "user-facing summary shown in the overlay strip"
changes:
  - op: claim
    faction: solari-sub-surface
    hexes: [[3, -4], [4, -4]]
  # …more change objects
---
```

Body is currently unused (kept for future rich descriptions). `message` may be the empty string but the key must be present-ish (the build defaults missing `message` to `""`).

## `Change` op cheat sheet

See `src/lib/regions.ts` for the exact union; `parseChange` in `scripts/build-content.ts` is the source of truth for required fields. Quick reference:

| op                 | required fields                              | use                                      |
| ------------------ | -------------------------------------------- | ---------------------------------------- |
| `add`              | `slug`, `name`, `faction`, `hexes`           | introduce a named multi-hex region       |
| `update`           | `slug` (+ any of `name`, `faction`, `hexes`) | mutate an existing region                |
| `remove`           | `slug`                                       | delete a region                          |
| `claim`            | `hexes`, `faction` (string slug or `null`)   | per-hex territory ownership change       |
| `skein-add`        | `slug`, `name`, `faction`, `hex`, `symbol`   | add a single-hex skein node              |
| `skein-update`     | `slug` (+ any of the skein-add fields)       | mutate a skein node                      |
| `skein-remove`     | `slug`                                       | delete a skein node                      |
| `skein-connect`    | `from`, `to` (skein slugs)                   | add an undirected edge between two nodes |
| `skein-disconnect` | `from`, `to`                                 | remove an edge                           |

Notes:

- `hexes` and `hex` use **axial `[q, r]` coords**. Typos silently render to the wrong tile — there's no schema check for "is this hex in-grid."
- `claim` with `faction: null` means _explicitly unowned_; absence of a claim means _whatever the base map said_ (which, for ring factions, is also unowned — only the Harlequins have base territory).
- `skein-connect`/`-disconnect` are validated: self-connecting throws, disconnecting a non-existent edge throws.

## How a layer file becomes pixels

`scripts/build-content.ts` reads every `*.md` here, runs `parseChange` per change (strict — typos throw the build), then folds the whole list via `foldRegions` / `foldFactionOverrides` / `foldSkein` to produce the `CURRENT_*` snapshots in `src/generated/layers.ts`. At runtime, the app uses the snapshots for the "now" view and the raw `LAYERS` array for timeline scrubbing.

## Writing layers via `/editor`

`bun dev` + `bun run editor:server` exposes a `/editor` UI that POSTs validated layer JSON to `http://0.0.0.0:3001/write-layer`, which writes the file into this directory. The sidecar enforces the filename regex, a 64 KB content cap, and refuses to overwrite existing files. After the file lands, `contentWatchPlugin` re-runs `build-content` and Vite full-reloads.
