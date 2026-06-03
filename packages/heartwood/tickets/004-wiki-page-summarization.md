id: 004
title: wiki-page-summarization
parent: 001
type: task
author: jbassin
---

## Overview
Enrich each index entry with a 1–2 sentence LLM-written summary and a bullet list of key facts. Incremental: only re-summarize pages whose `contentHash` changed since last run.

## Changes Required

### Summarizer
**File**: `src/wiki/summarize.ts` (new)
**Changes**: For each page where `summary` is null OR `contentHash` differs from the stored hash, call `llm.complete()` with the page text and a strict schema: `{ summary: string (≤200 chars), keyFacts: string[] (≤8 items, each ≤120 chars), entities: { people: string[], places: string[], orgs: string[] } }`. Use `MODEL_EXTRACT` (default Sonnet 4.6). The CLAUDE.md formatting rules can be cached system context.

### Index update
**File**: `src/wiki/load.ts` (extend), `state/wiki-index.json`
**Changes**: Merge summary/keyFacts/entities back into each entry. Re-write atomically (`Bun.write` to temp then rename).

### CLI integration
**File**: `src/cli/index-wiki.ts` (extend)
**Changes**: `bun run index-wiki` now does parse-then-summarize. `--no-llm` flag skips summarization. `--force` flag re-summarizes everything.

## Success Criteria

### Automated Verification
- [ ] After a full run, every page in the index has non-null `summary` and `keyFacts`
- [ ] Running `bun run index-wiki` a second time with no `content/` changes makes zero LLM calls (verified via per-run log)
- [ ] Touching one page and re-running summarizes exactly that one page
- [ ] All summaries pass schema validation (length caps, non-empty)

### Manual Verification
- [ ] Hand-rate 10 random summaries — they should accurately describe the page in one or two sentences
- [ ] `keyFacts` entries are actually in the source page (no hallucinations at this stage either)
- [ ] Cost of a full re-index is recorded and within an order of magnitude of the back-of-envelope estimate
