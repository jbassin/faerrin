# CLAUDE.md

Root guidance for the **Faerrin** monorepo — a Bun-workspaces repo for a Pathfinder 2e
("Faerrin") TTRPG campaign: three static sites, three CLI pipelines (one a Python/whisperx + TS
producer), a shared content platform, and a shared LLM package. Each package under `pkg/` also has its
own `CLAUDE.md` with local detail — **read the one for the directory you're working in**; it takes
precedence there. There's a repo-level [`README.md`](./README.md) with the human-facing overview.

## Version control: Jujutsu (jj), NOT git

`.jj/` is present (git-colocated). Use **jj** for all VCS operations — raw `git` commands can
corrupt jj state. There are **no git hooks** (husky was removed; jj doesn't run them), so
format/lint/test run in CI, not pre-commit. See the `jj` skill for safe usage (`--no-pager`, `-m`).

## Memory (project-local — not `~/.claude`)

Project memory lives **in the repo** at `thoughts/shared/memory/`, not in the harness default
`~/.claude/projects/.../memory/`. The index is auto-loaded into every session via this import:

@thoughts/shared/memory/MEMORY.md

- **Writing memory overrides the harness default path:** create/update memory files and the
  `MEMORY.md` index under `thoughts/shared/memory/` — **do not** write to `~/.claude`. Keep the
  harness format: one fact per file with frontmatter, plus a one-line `MEMORY.md` pointer per memory.
- This makes memory version-controlled and project-local. The rest of `thoughts/` holds research
  (`thoughts/shared/research/`) and per-package plans (`thoughts/<pkg>/plans/`).
- **Plans caveat:** native plan-mode still writes to the global `~/.claude/plans/` (the harness owns
  that path; it can't be redirected). For project-local plans, use the `create-plan` skill, which
  writes under `thoughts/<pkg>/plans/`.

## Octo workflows (Claude-only, always team mode)

This environment has access to **Claude only** — there are no other LLM providers (no Codex, Gemini,
OpenCode, Perplexity, Qwen, etc.), and that is intentional, not a misconfiguration. For any `/octo:*`
workflow:

- **Always run in team mode** (multi-agent). Never run single-instance, and **never ask** whether to
  use single vs team — the answer is always team.
- **The "multiple LLMs" are Claude subagents/personas**, never other providers. Use the octo persona
  agents (backend-architect, code-reviewer, database-architect, etc.) as the team's diversity. Do not
  route any step to a non-Claude model.
- **Never run or suggest `/octo:setup`** or any provider install/auth step. Missing-provider status in
  the availability banner is expected — do not treat it as a problem to fix or prompt the user about.

## Workspace

Bun workspaces; one root `bun.lock`; `node_modules` hoisted to the repo root. Members:
`workspaces: ["pkg/*"]` — every package is a top-level `pkg/<name>` folder whose name matches its
`@faerrin/<name>` package short-name.

Root scripts fan out per-app via `bun --filter '*'`:

```sh
bun install                      # one root install for the whole workspace
bun --filter '*' typecheck       # tsc --noEmit per app
bun --filter '*' check           # astro check (aether, face)
bun --filter '*' test            # bun test / vitest per app
bun --filter '*' build           # site builds (aether, strider, face)
bun --filter '*' lint            # strider eslint
bun --filter '*' format          # per-app prettier (no single root config — aether is semi:false)
```

- **Root scripts only delegate** to each app's own script (per-app cwd); never re-implement
  `astro build`/`vite build` at the root — relative `outDir`/`publicDir` would resolve wrong and
  break the live sites.
- **Declare every dependency you import.** Hoisting hides phantom deps until they bite (it bit
  `@tanstack/router-generator` and `@eslint/js` in strider).

## Packages (`pkg/`)

| Dir | Package | What it is |
|-----|---------|------------|
| `caster` | `@faerrin/caster` | Bun CLI — audio/podcast (TTS) pipeline |
| `face` | `@faerrin/face` | Astro + Solid podcast site (the player UI for caster's output) |
| `wretch` | `@faerrin/wretch` | Producer (Python/whisperx + TS) — Craig Discord recordings → transcript + audio (upstream of `@faerrin/content`) |
| `aether` | `@faerrin/aether` | Astro + Solid renderer — the campaign wiki site (`heart.iridi.cc`) |
| `strider` | `@faerrin/strider` | TanStack Start + Vite + React — interactive faction-map site |
| `llm` | `@faerrin/llm` | Shared Anthropic client (`AnthropicClient`) + pricing |
| `content` | `@faerrin/content` | **Content platform**: SSOT data (wiki + transcripts) + the generation pipeline |
| `gothic` | `@faerrin/gothic` | Shared amber/teal 40k-gothic **skin** — design tokens + fonts (pure CSS; consumed by strider + vellum) |
| `vellum` | `@faerrin/vellum` | Vite + React PF2e document forge (`vellum.iridi.cc`) — directive-markdown → gothic statblocks/handouts → PNG, via a warm Playwright render service |
| `mouth` | `@faerrin/mouth` | **Rust** PF2e dice/host Discord bot (Cargo workspace + SQLite). A script-less Bun member (built by the Dagger rust lane, not the bun lanes — like `gothic`). |

## Shared data — single source of truth (`pkg/content`)

The wiki and transcripts live **only** in `@faerrin/content` (`pkg/content`). Do **not** re-create
per-app copies. aether is canonical for content.

- `content/wiki/` — the Obsidian wiki. Also holds **generated** `wiki/Script/` transcript
  pages. aether's Astro build reads `wiki/` as its content root.
- `content/transcripts/` — canonical line-numbered transcripts.
- `content/scripts/` — the content pipeline (ingest → export → script) + `build-transcripts`.
  Run: `bun run --filter @faerrin/content pipeline` (or `build:transcripts`).
- Consumers reference the data by **filesystem path** (cwd-relative `../content/...`), not as a
  package import — except aether's renderer imports `folderIndexName` from `content/scripts/lib`.
- **`Script/` = aether-only transcript pages.** caster **excludes `Script/`** when
  reading `wiki/` (those aren't wiki articles).

## Conventions

- **Bun everywhere**: `bun test`, `bun run`, `bunx` (not npm/node/npx). aether & face are
  Astro (Vite under the hood) — note caster's CLAUDE.md "don't use vite" rule is about the
  **caster CLI only**, not `face` (the podcast site).
- **TypeScript**: non-Astro apps extend the root **`tsconfig.base.json`**; the Astro apps (aether,
  face) extend `astro/tsconfigs/strict`.
- **Env**: there is **no root `.env`** — each package that needs env vars has its own
  `.env.example` (`caster`, `wretch`, `content`); copy it to `.env`
  (gitignored) in that package. Bun auto-loads `.env` from the launched process's cwd and an
  inherited env var **overrides** a local `.env` file, so run each app from its own dir to get its
  own values. `ANTHROPIC_API_KEY` is needed by caster (in its own `.env`).
- **LLM calls** go through `@faerrin/llm` (`AnthropicClient`); don't call the Anthropic SDK directly.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) that just **calls Dagger** — the pipeline is a
  Dagger TypeScript module at the repo root (`.dagger/src/index.ts`, `dagger.json`), so the same steps
  run locally and in CI. Reproduce CI on your machine with `dagger call check` (typecheck → astro check
  → lint → test) and `dagger call build`; everything runs in a pinned `oven/bun:1.3.14` container. The
  module's generated SDK (`.dagger/sdk/`) is gitignored and regenerated by `dagger develop`.

## Gotchas (non-obvious; learned the hard way)

- **aether (the wiki renderer) is a live site behind a Caddy reverse proxy.** Its build output must
  stay byte-identical (763 files) — do not change `outDir`/`publicDir`/`base`. Validate big changes
  with a build + file-set diff.
- **Reverse-proxy config lives in `sites.caddyfile` at the repo root** (not "outside the repo" as older
  docs claimed). It defines `heart.iridi.cc` → `aether/public`, `caster.iridi.cc` → `face/dist`,
  and `strider.iridi.cc` → `strider/dist/client`. The file is **gitignored** (it embeds a Cloudflare
  DNS token), so it sits in the working tree on the host but is not version-controlled — keep that
  secret out of git, and if you edit routing, edit this file. **After this rename the host's copy must
  be updated** (old routes pointed at `quartz/public`, `caster/site/dist`, `listener/data/saved`).
- The URL-slug logic is **`aether/src/lib/slug.ts`** (renderer-only). `github-slugger` lives in
  aether because `slug.ts` uses it.
- **Never `.split("content/")` on a path** — the absolute path contains `pkg/content/` too, so a bare
  `content/` split is ambiguous. Split on the real base (`"content/wiki/"`).
- Whole workspace is green (typecheck + tests). Keep it that way: validate before declaring done.
