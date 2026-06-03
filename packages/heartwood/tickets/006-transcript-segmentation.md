id: 006
title: transcript-segmentation
parent: 001
type: task
author: jbassin
---

## Overview
First per-transcript LLM pass. Label every line range as `ooc`, `recap`, `ic`, `rules`, or `mixed`. Only `ic` and `recap` flow into the next pass.

## Changes Required

### Chunker
**File**: `src/transcript/chunk.ts` (new)
**Changes**: Split the transcript into overlapping windows (default 400 lines, 40-line overlap) so the segmenter can see context across boundaries. Each window keeps its original line numbers.

### Segmenter
**File**: `src/transcript/segment.ts` (new)
**Changes**: For each window, call `llm.complete()` with `MODEL_SEGMENT` (default Haiku 4.5). Cache the system prompt + segmentation rubric. Output schema: `{ segments: [{ startLine: number, endLine: number, label: 'ooc'|'recap'|'ic'|'rules'|'mixed', confidence: 'high'|'low', oneLineSummary: string }] }`. Stitch overlapping windows by taking the higher-confidence label where they disagree.

### Persistence
**File**: `state/segments/<filename>.json` (output)
**Changes**: Per-transcript segment output. Ledger `stages.segmented` timestamp updated on success.

### CLI
**File**: `src/cli/segment.ts` (new)
**Changes**: `bun run segment <transcript>` runs one transcript. `bun run segment --all` segments unprocessed ones.

## Success Criteria

### Automated Verification
- [ ] Segments cover every line of the transcript (no gaps, no overlaps in the stitched output)
- [ ] On `000.through-a-song-darkly.2025-8-28.txt`, lines 1–~100 are labeled `ooc` (verified against eyeball-check)
- [ ] Running twice produces identical output (deterministic with `temperature: 0`)
- [ ] Cost per transcript logged and within target (back-of-envelope: <$0.10 each with Haiku + caching)

### Manual Verification
- [ ] Hand-review segments on 2 transcripts — IC/OOC boundaries should be approximately correct
- [ ] `low` confidence segments cluster around transition points (sanity check)
