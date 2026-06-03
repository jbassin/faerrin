id: 007
title: claim-extraction
parent: 001
type: task
author: jbassin
---

## Overview
Pull atomic factual claims from `ic` + `recap` segments. Each claim is tagged with speaker, role (GM vs player), confidence, and line range.

## Changes Required

### Extractor
**File**: `src/transcript/extract.ts` (new)
**Changes**: For each `ic`/`recap` segment, call `llm.complete()` with `MODEL_EXTRACT` (default Sonnet 4.6). System prompt cached: rubric for what counts as a claim (entities, events, relationships, facts about the world — *not* dice rolls, rules questions, OOC asides). Speaker is parsed from the transcript line prefix (`Gamemaster:`, `<PlayerName>:`); role = `gm` if `Gamemaster`, else `player`.

Schema:
```ts
{
  claims: [{
    claim: string,         // single atomic statement
    lines: [number, number],  // inclusive line range
    speaker: string,
    role: 'gm' | 'player',
    confidence: 'stated' | 'inferred' | 'speculative',
    entities: string[]     // names/places mentioned
  }]
}
```

GM-spoken stated facts → `confidence: stated`. Player declarations about their own character → `stated`. Player speculation about NPCs/world → `speculative`. GM-implied → `inferred`. The prompt explicitly forbids inventing claims not present in the cited lines.

### Persistence
**File**: `state/claims/<filename>.json`
**Changes**: All claims from one transcript, sorted by line.

### CLI
**File**: `src/cli/extract.ts` (new)

## Success Criteria

### Automated Verification
- [ ] Every claim's `lines` range is inside an `ic` or `recap` segment from ticket 006
- [ ] No claim's range exceeds 20 lines (forces atomicity)
- [ ] `role: gm` only when the speakers in `lines` include `Gamemaster`
- [ ] Schema validation passes for all output

### Manual Verification
- [ ] On a hand-graded transcript, ≥80% of expected GM-stated facts appear as claims (manual recall check on golden set in ticket 011)
- [ ] Spot-check 20 claims: every one is supported by the cited lines
