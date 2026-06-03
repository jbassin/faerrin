id: 002
title: project-bootstrap
parent: 001
type: task
author: jbassin
---

## Overview
Replace the `bun init` stub with a real CLI surface and the shared utilities every later ticket depends on. No pipeline logic yet.

## Changes Required

### CLI dispatcher
**File**: `index.ts` (rewrite), `package.json` (scripts), `src/cli/*.ts` (new)
**Changes**: Subcommand router so `bun run <cmd>` dispatches to per-stage handlers. Each later ticket adds a handler file.

### Config + env loader
**File**: `src/config.ts` (new), `.env` (extend), `.env.example` (new)
**Changes**: Typed loader for `ANTHROPIC_API_KEY`, `GITLAB_TOKEN`, `GITLAB_PROJECT_ID`, `MODEL_SEGMENT`, `MODEL_EXTRACT`, `MODEL_MATCH`, `MODEL_PROPOSE`, `MODEL_VERIFY` (with sensible defaults: Haiku 4.5 for segment, Sonnet 4.6 for the rest). Bun auto-loads `.env`, so no `dotenv` dep.

### Anthropic SDK wrapper
**File**: `src/llm.ts` (new)
**Changes**: Thin wrapper over `@anthropic-ai/sdk` exposing `complete({ system, cached, user, model, schema? })`. The `cached` arg becomes a `cache_control: { type: 'ephemeral' }` block. JSON-schema mode wraps tool-use to coerce structured output. Records prompt/completion token counts to the per-run log.

### Per-run log
**File**: `src/log.ts` (new), `state/runs/<timestamp>.jsonl` (output)
**Changes**: Append-only JSONL of `{ stage, transcript?, page?, model, inputTokens, cachedTokens, outputTokens, costUSD, ms }` records, one per LLM call. `bun run cost-report` rolls them up.

## Success Criteria

### Automated Verification
- [x] `bun install` succeeds with `@anthropic-ai/sdk` added
- [x] `bun run` lists every registered subcommand
- [x] `bun test` passes a unit test that the config loader rejects missing required env
- [x] `bun run typecheck` (added to `package.json`) passes
- [x] A throwaway "hello" subcommand round-trips an Anthropic API call and writes a log line

### Manual Verification
- [x] `.env.example` documents every variable and `.env` is still gitignored
- [x] The cost-report rollup matches a hand-totalled small run

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.
