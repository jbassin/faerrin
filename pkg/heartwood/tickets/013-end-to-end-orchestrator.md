id: 013
title: end-to-end-orchestrator
parent: 001
type: task
author: jbassin
---

## Overview
Single command that processes every unprocessed transcript through the full pipeline, with checkpointing so a crash mid-way doesn't lose work.

## Changes Required

### Orchestrator
**File**: `src/cli/process.ts` (new)
**Changes**: `bun run process <transcript>` runs stages 1→6 (segment → extract → match → propose → verify → submit) sequentially, skipping stages already completed per the ledger. `bun run process-all` does the same for every unprocessed transcript. `--dry-run` propagates to `submit`. `--force <stage>` clears later ledger stages before running. `--stop-before <stage>` halts before the named stage.

### Concurrency control
**File**: `src/cli/process.ts`
**Changes**: One transcript at a time by default. `--concurrency N` to run N in parallel (each stage on each transcript is sequential but transcripts run independently).

### Run summary
**File**: `state/runs/<timestamp>-summary.md`
**Changes**: At the end of a `process-all` run, write a markdown summary: transcripts processed, MRs opened (with URLs), total cost, top errors. Print to stdout too.

## Success Criteria

### Automated Verification
- [ ] Killing the process mid-run and re-running resumes from the last completed stage (verified by file timestamps in `state/`)
- [ ] `bun run process-all --dry-run` on the current backlog produces dry-run output for every unprocessed transcript without opening any MR
- [ ] Per-stage `--force` works (re-runs only the targeted stage and everything after)

### Manual Verification
- [ ] End-to-end run against the test GitLab project on a single real transcript produces a reviewable MR
- [ ] Cost of full backfill (37 transcripts) is recorded and is within the budget you decide on before kicking it off
