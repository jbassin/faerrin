# Strider

An interactive faction map for a Pathfinder 2e city, statically rendered.

## About

Strider is a website that displays a map of **The Strider**, a city in a Pathfinder 2e tabletop campaign. The map is a circular hex grid carved up by twenty rival factions; clicking a faction opens its symbol, description, and roster of known members.

The map is also a timeline. Every event — a faction's birth, a territorial claim, an assassination, a coup — lives in a timestamped "layer" markdown file. The app replays these in chronological order, so you can scrub to any point in the campaign and see who controlled what at that moment.

The site is fully prerendered to static HTML and served by an external reverse proxy that lives outside this repo.

## Tech stack

| Concern           | Choice                                                     |
| ----------------- | ---------------------------------------------------------- |
| Framework         | TanStack Start (Vite, static prerender)                    |
| Language          | TypeScript (strict)                                        |
| Map rendering     | `pixi.js` + `pixi-filters` (see `src/components/HexMap/`)  |
| Markdown          | `gray-matter` + `remark` / `remark-html` (build-time only) |
| Styling           | CSS Modules                                                |
| Unit tests        | Vitest                                                     |
| E2E tests         | Playwright                                                 |
| Lint / format     | ESLint flat config + Prettier                              |
| Runtime / tooling | Bun                                                        |

## Getting started

Requires [Bun](https://bun.sh).

```bash
bun install
bun dev          # http://localhost:3000
bun run build    # static output → dist/client/
```

## Common commands

| Command                    | What it does                                 |
| -------------------------- | -------------------------------------------- |
| `bun dev`                  | Vite dev server at `localhost:3000`          |
| `bun run build`            | Static build to `dist/client/`               |
| `bun run lint`             | ESLint                                       |
| `bun run typecheck`        | Regenerate route tree, then `tsc --noEmit`   |
| `bun run test`             | Vitest unit tests                            |
| `bun run test:e2e`         | Playwright end-to-end tests                  |
| `bun run format`           | Prettier write                               |
| `bun run generate:content` | Rebuild `src/generated/{factions,layers}.ts` |
| `bun run editor:server`    | Dev-only sidecar (port 3001) for `/editor`   |

## Repo layout

```
src/         React components, routes, lib, generated content
content/     Authored markdown — factions/ and layers/
public/      Faction SVG symbols and self-hosted fonts
scripts/     Build helpers (content build, route gen, OG image, editor server)
e2e/         Playwright specs
tickets/     Project tickets (this repo does not use Linear)
```

See [`CLAUDE.md`](./CLAUDE.md) for the detailed breakdown and code conventions.

## Content

Authored material lives in [`content/`](./content/): faction profiles in `content/factions/*.md` and timeline events in `content/layers/*.md`. At build time, `scripts/build-content.ts` reads every markdown file, runs the body through `remark`, and emits typed TypeScript modules under `src/generated/` — so no `fs`, `gray-matter`, or `remark` ever reaches the client bundle.

Schemas and filename conventions for both file types are documented in [`CLAUDE.md`](./CLAUDE.md).

## Editor (dev only)

The `/editor` route is a development convenience. When you run `bun dev`, it serves a form that talks to `bun run editor:server` (port 3001) to write new layer files into `content/layers/`. The route is stripped from the production bundle via `routeFileIgnorePattern` in `vite.config.ts`, so `/editor` returns 404 on the deployed site.

## Testing

- **Unit**: `bun run test` — Vitest, auto-discovers `*.test.ts` next to the code.
- **E2E**: `bun run test:e2e` — Playwright, builds the site and serves `dist/client` on port 3000.

## Contributing

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `build`, `ci`).
- Run `bun run lint` and `bun run typecheck` before pushing.
- Tickets live in [`tickets/`](./tickets/) as markdown files — open one and read `tickets/README.md` for context.
- Code standards, file-organization rules, and content-authoring details are in [`CLAUDE.md`](./CLAUDE.md).
