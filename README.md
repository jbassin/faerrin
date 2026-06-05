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
| [`pkg/shared-content`](./pkg/shared-content) | `shared-content` | **Content platform** — the SSOT wiki + transcripts, and the pipeline that generates them |
| [`pkg/quartz`](./pkg/quartz) | `quartz` | Astro + Solid renderer — the campaign wiki site ([heart.iridi.cc](https://heart.iridi.cc)) |
| [`pkg/strider`](./pkg/strider) | `strider` | TanStack Start + Vite + React — interactive faction-map site ([strider.iridi.cc](https://strider.iridi.cc)) |
| [`pkg/caster`](./pkg/caster) | `caster` | Bun CLI — turns transcripts into a three-host podcast audio recap (TTS) |
| [`pkg/caster/site`](./pkg/caster/site) | `caster-site` | Astro + Solid podcast site ([caster.iridi.cc](https://caster.iridi.cc)) |
| [`pkg/heartwood`](./pkg/heartwood) | `heartwood` | Bun CLI — turns transcripts into wiki-edit GitHub PRs for human review |
| [`pkg/listener`](./pkg/listener) | `listener` | Producer (Python/whisperx + TS) — Craig Discord recordings → transcript + audio |
| [`pkg/faerrin-llm`](./pkg/faerrin-llm) | `@faerrin/llm` | Shared Anthropic client (`AnthropicClient`) + pricing |

## How the data flows

```
Craig recording ─▶ listener ─▶ shared-content (SSOT: wiki/ + transcripts/)
                                   │
                 ┌─────────────────┼──────────────────┐
                 ▼                 ▼                  ▼
              quartz           heartwood            caster ─▶ caster-site
           (wiki site)     (wiki-edit PRs)       (podcast audio)
```

**`shared-content` is the single source of truth.** The wiki and transcripts live there and only
there; consumers read them by filesystem path (`../shared-content/...`) — they do **not** keep their
own copies. quartz is canonical for wiki content.

## Getting started

Requires [Bun](https://bun.sh). Some packages need extra tools (`ffmpeg` for caster; `uv` + `ffmpeg`
for listener) and their own `.env` — see each package's `CLAUDE.md` / `README.md`.

```sh
bun install                      # one root install for the whole workspace
```

Root scripts fan out across every workspace member (each delegates to that package's own script):

```sh
bun run typecheck                # tsc --noEmit per app
bun run check                    # astro check (quartz, caster-site)
bun run test                     # bun test / vitest per app
bun run build                    # site builds (quartz, strider, caster-site)
bun run lint                     # eslint (strider)
bun run format                   # per-app prettier
```

There's **no root `.env`** — each package that needs env vars has its own `.env.example`; copy it to
`.env` (gitignored) in that package. `ANTHROPIC_API_KEY` is needed by both caster and heartwood.

## CI

CI is [Dagger](https://dagger.io) (TypeScript module at `.dagger/`), called from GitHub Actions
(`.github/workflows/ci.yml`), so the same steps run locally and in CI inside a pinned `oven/bun`
container:

```sh
bun run ci:check                 # dagger call check  (typecheck → astro check → lint → test)
bun run ci:build                 # dagger call build
bun run ci                       # dagger call all
```

## Version control: Jujutsu (jj)

This repo is developed with **[jj](https://github.com/jj-vcs/jj)** (git-colocated). Raw `git` commands
can corrupt jj state — use `jj`. There are no git hooks; format/lint/test run in CI.

## Deployment

The three sites are served by a [Caddy](https://caddyserver.com) reverse proxy configured in
`sites.caddyfile` at the repo root (gitignored — it embeds a Cloudflare DNS token). It maps
`heart.iridi.cc → quartz/public`, `caster.iridi.cc → caster/site/dist`, and
`strider.iridi.cc → strider/dist/client`.
