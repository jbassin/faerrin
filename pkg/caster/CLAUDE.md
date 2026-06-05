# CLAUDE.md — `caster`

Guidance for the **caster** package: a **Bun CLI** that turns Pathfinder 2e session transcripts into a
three-host, podcast-style **audio recap**, grounded against the campaign's setting wiki. See
`README.md` for the user-facing walkthrough, prerequisites, and content schema — this file is the
working contract for editing the code.

## Pipeline (five cached stages)

The CLI entrypoint is **`src/cli.ts`**; each stage is a directory under `src/` and caches its output to
`out/`, so re-running a stage is cheap and a later stage reads the earlier one's cache.

```
ingest → distill → script → tts → assemble
```

| Stage | Script | Does | LLM / tool |
|---|---|---|---|
| ingest   | `bun run ingest [id]`   | parse transcript + resolve speakers + build wiki link-graph | — |
| distill  | `bun run distill <id>`  | transcript → ordered story beats | Claude (Opus) via `@faerrin/llm` |
| script   | `bun run script <id>`   | beats → Reed/Quill/Charlotte roundtable (wiki-grounded, inline v3 audio tags) | Claude via `@faerrin/llm` |
| tts      | `bun run tts <id> --provider=<p>` | script → audio clips | ElevenLabs (default) · Edge (free) · mock (offline) |
| assemble | `bun run assemble <id>` | clips → `episode.mp3` + `transcript.md` | ffmpeg (concat + loudnorm) |

Run a stage across the workspace with `bun run --filter @faerrin/caster <stage> <id>`, or from this dir with
`bun run <stage> <id>`. `bun run typecheck` / `bun test` are the gates.

## Content sources (SSOT — read, don't copy)

Defaults live in `src/ingest/index.ts`:

- **transcripts** ← `../content/transcripts` (the monorepo SSOT)
- **wiki** ← `../content/wiki` (the monorepo SSOT; aether is canonical). caster **excludes
  `Script/`** — those are aether transcript pages, not wiki articles.
- **shibboleth** ← local `content/shibboleth.json` (the speaker map: `arcTitle → { isMain, roles }`).
  `content/pronunciations.json` is an optional local lexicon override.

Do **not** re-create per-app `wiki/`/`transcripts/` copies here — that's exactly the stale pattern the
removed `update-content.sh` embodied. Edit content in `@faerrin/content`.

## Conventions

**Bun-first, and this is a CLI — keep it that way.** Use `bun <file>`, `bun test`, `bun install`,
`bun run`, `bunx` (not npm/node/npx). Prefer `Bun.file` over `node:fs`; `` Bun.$`…` `` over execa; Bun
auto-loads `.env` (no dotenv).

> **"Don't use vite" applies to the caster CLI only.** This package is a CLI with no bundler — never
> pull Vite/web-bundler tooling into it. The Astro+Solid podcast **site** is its own package,
> `pkg/face` (`@faerrin/face`), which *is* Vite-under-Astro; that rule does not apply there.

- **LLM calls go through `@faerrin/llm`** (`AnthropicClient`), never the Anthropic SDK directly. Both
  `distill` and `script` need `ANTHROPIC_API_KEY` in this package's `.env`.
- **ffmpeg + ffprobe on `PATH`** are required for `assemble` only (Stage 5).
- **TTS providers** (Stage 4): ElevenLabs is the default (`ELEVENLABS_API_KEY`, paid; on `eleven_v3`
  uses the Text-to-Dialogue API). `--provider=edge` is free (network only); `--provider=mock` is the
  offline silent-audio provider the tests use.
- **Tests** are `bun:test`, co-located (`foo.ts` ↔ `foo.test.ts`). Integration tests
  (`*.integration.test.ts`) read the real `../content/` data.
