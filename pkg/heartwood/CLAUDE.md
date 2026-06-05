## Project

Heartwood is a pipeline that turns Pathfinder 2e session transcripts into pull-requested edits on a hand-maintained Obsidian wiki. Raw transcripts (read from `../content/transcripts/`, the monorepo SSOT generated from aether's pipeline) are segmented, mined for factual claims, matched against existing wiki pages (read from `../content/wiki/`, the monorepo SSOT — aether is canonical), and emitted as proposed edits that ship as GitHub pull requests for human review. The two cardinal constraints: keep LLM cost bounded (no shoveling the entire wiki into every call) and let no hallucination reach the wiki without a human gate (the PR review).

## Repository layout

```
src/                          ← all pipeline code
  cli/                        ← commander.js entrypoints, one file per command
  wiki/                       ← wiki parsing (from ../content/wiki/), indexing, summarization
  transcript/                 ← discovery, ledger, chunking, segmentation, extraction
  reconcile/                  ← entity resolution, candidate match, classify, cluster, propose, validate
  github/                     ← REST client, dry-run, commit/PR apply, submissions ledger, respond
  config.ts                   ← env-var loading (frozen, lazy)
  llm.ts                      ← single `complete()` wrapping Anthropic SDK; emits structured output via Zod schema
  pricing.ts                  ← USD/1M-token rate table
  log.ts                      ← per-run JSONL cost log writer/summarizer
# (wiki read from ../content/wiki/ — the SSOT; aether canonical. See "Content Files" below)
state/                        ← pipeline outputs, one file per transcript per stage (see "Pipeline" below)
tickets/                      ← numbered spec docs (001-…) that drive the work
thoughts/shared/plans/        ← pre-implementation plans, one per ticket
index.ts                      ← top-level entrypoint — registers all CLI commands
```

Transcripts are read from `../content/transcripts/` (the monorepo SSOT, generated from
aether's pipeline via `bun run --filter @faerrin/content build:transcripts`). heartwood no longer keeps
its own `transcripts/`, and the old `update-transcripts.sh` (broken `/emerald/` paths + fixed-header
transform) has been removed.

## Pipeline

### Stage order

```
index-wiki  (one-time / when the wiki changes)
   ↓
segment → extract → resolve → match → propose → submit → respond
```

`index-wiki` builds `state/wiki-index.json` from the wiki (`../content/wiki/`, the SSOT — aether canonical; `Script/` excluded) (summaries, key facts, entities — LLM-generated). The six pipeline stages plus `respond` run per transcript. The orchestrator `process` runs them in order for one or all transcripts.

| Stage | CLI | Reads | Writes | Model |
|---|---|---|---|---|
| segment | `bun run segment [name]` | transcript + wiki-index | `state/segments/<file>.json` | Haiku (`MODEL_SEGMENT`) |
| extract | `bun run extract [name]` | segments | `state/claims/<file>.json` (+ `_debug/`) | Sonnet (`MODEL_EXTRACT`), Haiku filter (`MODEL_FILTER`) |
| resolve | `bun run resolve [name]` | claims + wiki-index | `state/resolutions/<file>.json` | Haiku (`MODEL_RESOLVE`) |
| match | `bun run match [name]` | resolutions + wiki-index + wiki | `state/matches/<file>.json` (+ `_debug/`) | Sonnet (`MODEL_MATCH`) |
| propose | `bun run propose [name]` | matches + wiki | `state/proposals/<file>.json` (+ `_debug/`) | Sonnet (`MODEL_PROPOSE`) |
| submit | `bun run submit [name] [--dry-run]` | proposals + wiki | `state/submissions/<file>.json` or `state/dry-runs/<basename>/`; opens GitHub PR | — |
| respond | `bun run respond [name]` | submissions + open PR review threads | replies / revised commits to the PR | Sonnet (`MODEL_VERIFY`) |

End-to-end: `bun run process <name>` (or `bun run process --all`). Flags: `--dry-run`, `--force <stage>`, `--stop-before <stage>`, `--concurrency <n>`. Concurrent workers serialize their ledger writes through a `LedgerMutex` (`src/cli/process.ts`).

### Ledger

`state/processed.json` is the single source of truth for what's been processed. Each entry tracks a transcript by filename + `contentHash` (sha256 of raw bytes) and carries stage timestamps:

```
stages: { segmented, extracted, resolved, matched, proposed, verified, prOpened }
```

If a transcript's bytes change, `reconcile()` resets its stages so it re-runs. Use `bun run transcripts list|status|reset` to inspect or reset. Ledger writes are atomic (`.tmp` → `rename`).

### Cost log

Every LLM call writes one JSONL line to `state/runs/<ISO-timestamp>.jsonl` via `recordLLMCall()` in `src/log.ts`. Inspect with `bun run cost-report [path]` (defaults to latest). `state/runs/*` is gitignored except for `.gitkeep`.

### What's committed under `state/`

Committed: `state/processed.json`, `state/wiki-index.json`, and the rolled-up per-stage JSONs (`state/segments/*.json`, `state/claims/*.json`, `state/resolutions/*.json`, `state/matches/*.json`, `state/proposals/*.json`).

Ignored: `state/runs/*`, `state/{claims,matches,proposals}/_debug/`.

## Configuration

Bun auto-loads `.env`. Required vars (`src/config.ts` throws if missing):

- `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN` — PAT (classic `repo` scope, or fine-grained Contents + Pull requests RW) for the repo hosting the wiki
- `GITHUB_REPO` — `owner/name` of the GitHub repo hosting the wiki
- `GITHUB_API_URL` — **optional**, base API URL (defaults to `https://api.github.com`; set for GitHub Enterprise)

Optional model overrides (defaults in parens):

- `MODEL_SEGMENT` (Haiku 4.5), `MODEL_EXTRACT` (Sonnet 4.6), `MODEL_FILTER` (Haiku 4.5)
- `MODEL_RESOLVE` (Haiku 4.5), `MODEL_MATCH` (Sonnet 4.6)
- `MODEL_PROPOSE` (Sonnet 4.6), `MODEL_VERIFY` (Sonnet 4.6)

## Code conventions

### Bun, not Node

- `bun <file>` instead of `node` or `ts-node`; `bun test` instead of jest/vitest; `bun install`; `bun run <script>`; `bunx`
- Prefer `Bun.file` over `node:fs` read/write. Use `` Bun.$`…` `` instead of execa.
- Bun auto-loads `.env` — don't add dotenv.

### LLM calls

Every LLM call goes through `complete()` in `src/llm.ts`. Pass a Zod schema and the call returns a parsed, typed value (enforced via Anthropic tool-use under the hood). `temperature: 0` is set universally. The `cached: true` flag adds an ephemeral cache breakpoint on the system prompt.

Don't call the Anthropic SDK directly — the `complete()` wrapper also records the call's cost into the current run's JSONL.

### Zod at I/O boundaries

State files written and read from disk are validated with Zod at the parse boundary (`LedgerSchema`, `SubmissionsFileSchema`, etc.). Internal in-memory types are plain TypeScript interfaces. Don't validate in the middle of code paths where data was already parsed at the boundary.

### Atomic writes

State files are written via a `.tmp` intermediate and `rename()` to avoid partial writes on crash. Follow the same pattern for any new state file.

### Dependency injection for tests

Stage functions accept optional `completeFn` and `writeLedgerFn` parameters so tests can substitute stubs. Don't reach for module mocking — pass the dependency in.

### Testing

`bun:test`, co-located with source (`foo.ts` ↔ `foo.test.ts`). No shared fixture or helper modules — each test file defines its own inline factories. Some tests (e.g. `src/wiki/load.test.ts`) read the real wiki at `../content/wiki/`.

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

Run with `bun test`; typecheck with `bun run typecheck`.

### Error handling style

CLI `*One` functions throw on precondition failures (missing upstream state, stale content hashes). The `--all` and orchestrator loops catch, record the error via the ledger's `recordError()`, and continue; failures aggregate into a summary at the end of the run.

---

## Content Files

The wiki (`../content/wiki/`, the SSOT — aether canonical) holds Obsidian-flavored markdown files that form the world wiki. Each file represents a single topic: a place, person, organization, game rule, or cosmic phenomenon. **Proposed edits must match these conventions** — the LLM is given these rules as part of the propose-stage prompt. (heartwood reads this corpus excluding `Script/`, which holds aether-generated transcript pages.)

### Directory structure

```
../content/wiki/
├── index.md                       ← root article
├── Timeline.md                    ← world timeline
├── Geography/
│   ├── index.md
│   ├── [Region].md                ← simple region (no sub-pages)
│   └── [Region]/
│       ├── index.md               ← region with sub-pages
│       └── [City]/
│           ├── index.md
│           └── [District]/
│               └── index.md
├── Divinity/
│   ├── index.md
│   ├── [Shared Article].md
│   ├── Outer Gods/
│   │   └── [God Name].md
│   └── Fiends/
│       └── [Fiend Name].md
├── Org/
│   ├── index.md
│   ├── [Simple Org].md            ← single-file for minor orgs
│   └── [Complex Org]/
│       ├── index.md
│       ├── [Sub-group]/
│       │   └── index.md
│       └── People/
│           └── [Full Name].md
├── Phenomena/
│   ├── [Phenomenon].md
│   └── [Complex Phenomenon]/
│       ├── index.md
│       └── [Entry].md
└── Rules/
    └── [Rule Name].md
```

**Single file vs. folder:** use a single `.md` when there are no sub-topics. Create a folder with `index.md` when the entry has child pages (e.g., a city with districts, an org with named people).

**File naming:** Title Case with spaces, matching the in-world name. Special characters (é, æ, ø) are allowed. People files use the full name: `Elias Ramsey.md`.

### Frontmatter

Optional; include only fields you need:

```yaml
---
title: Display Title          # shown in wiki; falls back to filename if omitted
aliases:
  - Short Name                # alternative names usable in wikilinks
tags:
  - TagName                   # capitalize; use for race, faction, type
img: https://...              # portrait image URL — character pages only
---
```

Tags in current use: `Research`, `Host`, `Religious`, `Choral`, `Dwarf`.

### Wikilinks

```
[[Page Name]]                          ← link by page name or alias
[[path/to/index|Display Text]]         ← explicit path + display override
[[Phenomena/Harmony/index|Harmony]]    ← use paths when names are ambiguous
```

Link on the first mention of any notable noun (person, place, org, phenomenon). Don't repeat the link within the same paragraph.

### Callouts

```markdown
> [!note] Optional Title
> Supplementary mechanical or world detail — sidebars, asides, historical context.

> [!quote] Source Attribution
> In-universe quote or document excerpt. Put the source in the title line.
> Omit the title for anonymous or mysterious sources.
```

### Templates by content type

**Lore article (place, organization, phenomenon):**

```markdown
---
title: Page Title
aliases:
  - Short Name
---
Opening summary sentence.

Prose body. [[Link]] notable terms on first mention.

### Sub-section (if needed)

More detail.

> [!note] Sidebar Title
> Supplementary detail.
```

**Deity stat block** — uses ` :: ` (space–colon–colon–space) as label/value separator; end every line except the last in a block with ` <br />`:

```markdown
---
aliases:
  - Short Name
---
Description paragraph.

**Category** :: Outer God <br />
**Edicts** :: ... <br />
**Anathema** :: ... <br />
**[[Divine Raiment]]** :: ... <br />
**[[Celestial Prescence]]** :: ...

### Devotee Benefits
**Divine Ability** :: ... <br />
**Divine Font** :: harm or heal <br />
**Divine Sanctification** :: can choose holy or unholy <br />
**Divine Skill** :: ... <br />
**Favored Weapon** :: [weapon](https://2e.aonprd.com/Weapons.aspx?ID=XXX) <br />
**Domains** :: [domain](https://2e.aonprd.com/Domains.aspx?ID=XXX), ... <br />
**Cleric Spells** :: 1st: [spell](https://2e.aonprd.com/Spells.aspx?ID=XXX), ...
```

**Character / NPC:**

```markdown
---
tags:
  - Race
img: https://i.imgur.com/example.png
---
Physical appearance. Personality in one or two sentences.

Role in [[Org/OrgName/index|Org]] sentence.
```

**Rules article:** plain prose, no special structure. Use `[[wikilinks]]` when referencing other rules terms.

**In-universe flavor document:** wrap in `<pre>` tags (logs, letters, transmissions):

```markdown
<pre>
... in-world text, can include emphasis and layout as needed ...
</pre>
```

**Stub page** — a placeholder so wikilinks resolve before content is written:

```markdown
---
title: Page Title
aliases:
  - Alias
---
```
