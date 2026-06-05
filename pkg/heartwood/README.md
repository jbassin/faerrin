# heartwood

A Bun CLI that turns Pathfinder 2e **session transcripts into pull-requested edits** on the
hand-maintained Obsidian wiki. Transcripts are segmented, mined for factual claims, matched against
existing wiki pages, and emitted as proposed edits that ship as **GitHub PRs for human review**.

Two cardinal constraints shape the design: keep LLM cost bounded (never shovel the whole wiki into a
call) and let no hallucination reach the wiki without a human gate (the PR review).

> Inputs are the monorepo SSOT in [`pkg/content`](../content): transcripts from
> `../content/transcripts/`, the wiki from `../content/wiki/` (excluding `Script/`).
> heartwood keeps no copies of its own.

## Getting started

Requires [Bun](https://bun.sh). Copy `.env.example` → `.env` and fill in:

- `ANTHROPIC_API_KEY` — LLM access (calls go through [`@faerrin/llm`](../llm)).
- `GITHUB_TOKEN` — PAT (classic `repo`, or fine-grained Contents + Pull requests RW) for the repo
  hosting the wiki.
- `GITHUB_REPO` — `owner/name` of that repo. `GITHUB_API_URL` is optional (GitHub Enterprise).

```bash
bun install
bun run index-wiki            # one-time: build state/wiki-index.json from the wiki
bun run process <name>        # run the full pipeline for one transcript (or --all)
```

## Pipeline

```
index-wiki                                   (one-time / when the wiki changes)
   ↓
segment → extract → resolve → match → propose → submit → respond
```

Each stage has its own command (`bun run segment|extract|resolve|match|propose|submit|respond [name]`)
and writes one file per transcript per stage under `state/`. `bun run process <name>` runs them in
order; flags: `--dry-run`, `--force <stage>`, `--stop-before <stage>`, `--concurrency <n>`. `submit`
opens the GitHub PR; `respond` replies to / revises PR review threads.

`state/processed.json` is the ledger (tracks each transcript by filename + content hash + per-stage
timestamps); changing a transcript's bytes makes it re-run. Inspect with
`bun run transcripts list|status|reset`. Every LLM call logs cost to `state/runs/<ts>.jsonl` —
`bun run cost-report` summarizes the latest run.

## Development

```bash
bun test                     # bun:test, co-located *.test.ts
bun run typecheck            # tsc --noEmit
```

See [`CLAUDE.md`](./CLAUDE.md) for the stage-by-stage contract, the `complete()` LLM wrapper, the
state/ layout, and the wiki content conventions the propose stage enforces.
