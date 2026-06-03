id: 005
title: transcript-discovery-ledger
parent: 001
type: task
author: jbassin
---

## Overview
Parse transcript filenames, maintain a durable ledger of processing state, and expose status commands. Must survive `update-transcripts.sh` wiping `transcripts/`.

## Changes Required

### Filename parser
**File**: `src/transcript/discover.ts` (new)
**Changes**: Walk `transcripts/`, regex `^(\d+)\.([^.]+)\.(\d{4}-\d{1,2}-\d{1,2})\.txt$` → `{ id, campaignName, sessionDate, isMain: id < 100, filename, contentHash }`. Sort by `(campaignId, sessionDate)`.

### Processing ledger
**File**: `src/transcript/ledger.ts` (new), `state/processed.json` (output, **checked into git**)
**Changes**: Schema `{ entries: [{ filename, contentHash, stages: { segmented: ts|null, extracted: ts|null, matched: ts|null, proposed: ts|null, verified: ts|null, prOpened: ts|null }, prUrl?, errors: [{ stage, ts, message }] }] }`. Survives `transcripts/` deletion because it lives in `state/` and keys off `filename + contentHash`. Hash change ⇒ entry kept but stages cleared.

### CLI commands
**File**: `src/cli/transcripts.ts` (new)
**Changes**: `bun run transcripts list` shows status table. `bun run transcripts status <name>` shows per-stage detail. `bun run transcripts reset <name> [--stage <name>]` clears stage timestamps to force reprocessing.

## Success Criteria

### Automated Verification
- [ ] `bun run transcripts list` enumerates all 37 current transcripts and identifies 26 main (id 000) vs 11 side/one-shot (ids 101+)
- [ ] Filename parser unit tests cover both id ranges, multi-word campaign names with hyphens, and date variants (`2025-8-28` vs `2025-12-30`)
- [ ] Re-running discovery after `update-transcripts.sh` keeps ledger entries whose contentHash is unchanged
- [ ] Changing a transcript's content (hash change) marks the ledger entry as needing reprocessing

### Manual Verification
- [ ] Ledger file is committed and survives an `update-transcripts.sh` round-trip
