# Faerrin

A [Bun-workspaces](https://bun.sh/docs/install/workspaces) monorepo for **Faerrin**, a Pathfinder 2e
TTRPG campaign: two static sites, three CLI pipelines, a shared content platform, and a shared LLM
client. Session recordings go in one end; a published wiki, an interactive faction map, and a
podcast-style audio recap come out the other.

> **Contributing with an AI agent?** Read [`CLAUDE.md`](./CLAUDE.md) first, then the `CLAUDE.md` in the
> package you're touching — it takes precedence there.

## Packages

| Directory | Package | What it is |
|-----------|---------|------------|
| [`pkg/content`](./pkg/content) | `@faerrin/content` | **Content platform** — the SSOT wiki + transcripts, and the pipeline that generates them |
| [`pkg/aether`](./pkg/aether) | `@faerrin/aether` | Astro + Solid renderer — the campaign wiki site ([heart.iridi.cc](https://heart.iridi.cc)) |
| [`pkg/strider`](./pkg/strider) | `@faerrin/strider` | TanStack Start + Vite + React — interactive faction-map site ([strider.iridi.cc](https://strider.iridi.cc)) |
| [`pkg/caster`](./pkg/caster) | `@faerrin/caster` | Bun CLI — turns transcripts into a three-host podcast audio recap (TTS) |
| [`pkg/face`](./pkg/face) | `@faerrin/face` | Astro + Solid podcast site ([caster.iridi.cc](https://caster.iridi.cc)) |
| [`pkg/wretch`](./pkg/wretch) | `@faerrin/wretch` | Producer (Python/whisperx + TS) — Craig Discord recordings → transcript + audio |
| [`pkg/llm`](./pkg/llm) | `@faerrin/llm` | Shared Anthropic client (`AnthropicClient`) + pricing |

## How the data flows

```
Craig recording ─▶ wretch ─▶ content (SSOT: wiki/ + transcripts/)
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
                 aether                  caster ─▶ face
              (wiki site)             (podcast audio)
```

**`@faerrin/content` is the single source of truth.** The wiki and transcripts live there and only
there; consumers read them by filesystem path (`../content/...`) — they do **not** keep their
own copies. aether is canonical for wiki content.

## Getting started

Requires [Bun](https://bun.sh). Some packages need extra tools (`ffmpeg` for caster; `uv` + `ffmpeg`
for wretch) and their own `.env` — see each package's `CLAUDE.md` / `README.md`.

```sh
bun install                      # one root install for the whole workspace
```

Root scripts fan out across every workspace member (each delegates to that package's own script):

```sh
bun run typecheck                # tsc --noEmit per app
bun run check                    # astro check (aether, face)
bun run test                     # bun test / vitest per app
bun run build                    # site builds (aether, strider, face)
bun run lint                     # eslint (strider)
bun run format                   # per-app prettier
```

There's **no root `.env`** — each package that needs env vars has its own `.env.example`; copy it to
`.env` (gitignored) in that package. `ANTHROPIC_API_KEY` is needed by caster.

## CI

CI is plain **GitHub Actions** (`.github/workflows/ci.yml`): each gate is its own job so they run in
parallel, with Bun + Playwright dependency caching. Reproduce most of it locally with:

```sh
bun run ci    # typecheck → check → lint → test → build (all apps); visual-regression runs in CI only
```

The `visual-regression` job runs inside the pinned `oven/bun:1.3.14` container because vellum's golden
images were generated there. Bun is pinned to `1.3.14` across all jobs.

## Version control: Jujutsu (jj)

This repo is developed with **[jj](https://github.com/jj-vcs/jj)** (git-colocated). Raw `git` commands
can corrupt jj state — use `jj`. There are no git hooks; format/lint/test run in CI.

## Deployment

The three sites are served by a [Caddy](https://caddyserver.com) reverse proxy configured in
`sites.caddyfile` at the repo root (gitignored — it embeds a Cloudflare DNS token). It maps
`heart.iridi.cc → aether/public`, `caster.iridi.cc → face/dist`, and
`strider.iridi.cc → strider/dist/client`.
