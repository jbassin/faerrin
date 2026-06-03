# Stakeholder Requests Implementation Plan

## Overview

Stakeholders reviewed pipeline output and flagged two problems: (1) extracted claims are full of scene-blocking / episodic narration that doesn't belong in a wiki, and (2) `mixed` segments require human review and player speculation leaks into the claim set. This plan addresses both by refining the segmentation pass to eliminate `mixed` blocks and add a `combat` label that is excluded from extraction, tightening the extraction rubric and speaker filter, and adding a post-extraction wiki-worthiness filter.

## Current State Analysis

- **Segmentation** (`src/transcript/segment.ts`): 18% of all lines (556 of 2,668 segments across 37 files) land in `mixed` blocks. These flow into extraction unchanged, producing claims that can't be trusted without manual review.
- **Extraction** (`src/transcript/extract.ts`): The system prompt prohibits dice rolls and OOC chatter but says nothing about scene-blocking. Spot-checking one transcript shows ~25/30 consecutive GM-stated claims are pure episodic narration (seat positions, badge inspections, trolley arrivals). 36% of claims are player-spoken; most are paraphrases of what the GM already said.
- **State**: 37 transcripts segmented, 1 transcript extracted and matched. All downstream state can be reset without significant loss.

## Desired End State

After this plan:
- No `mixed` segments appear in `state/segments/*.json` — every segment is `ic`, `ooc`, `recap`, `rules`, or `combat`.
- `combat` segments are identified at segmentation time and never enter extraction.
- Extracted claims are wiki-worthy facts: entity descriptions, persistent traits, organizational/political relationships, named places, world history. Scene-blocking, dialogue paraphrase, and episodic action are absent.
- Player-spoken claims only appear when originating from a `recap` segment. All `ic` claims come from the GM.
- A post-extraction worthiness filter provides a second gate before claims reach the match stage, with dropped claims logged to `state/claims/_debug/` for audit.

**Verify by**: re-segmenting + re-extracting `000.through-a-song-darkly.2025-8-28.txt` and hand-checking that (a) `mixed` count is 0 in the segments file, and (b) spot-checking 30 random claims shows no scene-blocking.

## What We're NOT Doing

- Changing the match/classify/propose pipeline (tickets 008–013).
- Changing how the wiki index or summarization works (tickets 003–004).
- Re-running all 37 transcripts — only the first one for end-to-end validation. Remaining transcripts run after manual sign-off.
- Adding new ledger stages — `segmented`, `extracted`, `matched` are unchanged.
- Removing the `mixed` label from the schema — the type still exists so existing test fixtures compile; the refinement pass just ensures it's never written to disk.
- Treating `combat` as a sub-type of `ic` for any downstream purpose — it is intentionally excluded from extraction.

---

## Phase 1: Add `combat` Label and Eliminate `mixed` Segments

### Overview

Add a `combat` label to the segmenter so purely mechanical fight sequences are identified immediately and skipped by extraction. Then, after the initial windowed pass, re-segment any remaining `mixed` segments with a stricter prompt and smaller windows so nothing ambiguous reaches extraction.

### Changes Required

#### 1. Add `combat` to `LABELS` and `SEGMENT_SYSTEM_PROMPT`
**File**: `src/transcript/segment.ts`

Add `'combat'` to the `LABELS` tuple (line 5). Add a rubric entry to `SEGMENT_SYSTEM_PROMPT`:

```
- combat: an active combat encounter — initiative, attack rolls, damage, HP tracking, tactical
          movement, spell targeting. Ends when the GM signals the encounter is over. Brief combat
          interjections inside IC narration are still IC; only label `combat` when the transcript
          is predominantly mechanical fight resolution.
```

`combat` is in-character and may technically contain GM narration, but never contains wiki-worthy information, so it is excluded from extraction by `buildExtractionUnits` (not added to `EXTRACT_LABELS`).

#### 2. Refinement system prompt and per-segment function
**File**: `src/transcript/segment.ts`

Add a `REFINE_SYSTEM_PROMPT` constant below `SEGMENT_SYSTEM_PROMPT`. Key differences from the initial prompt:
- Disallows `mixed` entirely ("you must assign every line to exactly one of: `ooc`, `recap`, `ic`, `rules`, `combat`").
- Shorter guidance — the model already saw these lines once; it just needs to commit.
- Same output schema (`WindowOutputSchema`) so existing validation and `normalizeWindow` reuse works.

Add `refineMixedSegments(segments, transcriptText, opts)` which:
1. Identifies all segments with `label === 'mixed'`.
2. For each, slices the raw transcript lines, calls `chunkTranscript` with `windowLines: 80, overlapLines: 10`.
3. Runs `segmentWindow` with the refinement prompt on each window.
4. Stitches the per-mixed-block output with `stitchSegments`.
5. Returns a new segment array with every mixed segment replaced by its refined sub-segments.

Update `segmentTranscript` to call `refineMixedSegments` immediately after `stitchSegments` if any `mixed` segments remain.

```ts
// After stitching:
const stitched = stitchSegments(outputs, totalLines);
const final = stitched.some(s => s.label === 'mixed')
  ? await refineMixedSegments(stitched, text, { model: opts.model, transcript: opts.transcript, completeFn: opts.completeFn })
  : stitched;
return { segments: final, totalLines, windowCount: windows.length };
```

`SegmentTranscriptResult` gains a `refinedCount` field (number of mixed blocks that were refined) for the CLI log line.

#### 2. CLI log line
**File**: `src/cli/segment.ts`

Update the console.log in `segmentOne` to include the refined count and `combat` segment count:
```
segmented foo.txt: 44 segments (28 ic, 8 ooc, 4 recap, 4 combat) — 12 mixed blocks refined
```
If `refinedCount === 0`, omit the refined suffix.

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/segment.test.ts` — all existing tests pass
- [x] New unit test: feed a transcript slice known to produce mixed blocks; assert output contains no `mixed` label
- [x] New unit test: feed a transcript slice with obvious combat (initiative, attack rolls); assert at least one `combat` segment
- [ ] `bun run segment 2025-8-28` completes without error; `state/segments/000.through-a-song-darkly.2025-8-28.txt.json` contains 0 segments with `label === 'mixed'`
- [x] `bun run typecheck` passes

#### Manual Verification
- [ ] Spot-check 5 refined blocks in the segment file: confirm the split makes sense (e.g. IC narration separated from rules sidebar)
- [ ] Confirm `combat` segments appear where expected: spot-check 3 combat blocks against the raw transcript and verify they are fight sequences, not narrative

---

## Phase 2: Tighten Extraction Rubric and Player Filter

### Overview

Rewrite the extraction system prompt to explicitly define wiki-worthy vs. not, and add a speaker-role gate: in `ic` segments only GM utterances produce claims; in `recap` segments player utterances are still allowed.

### Changes Required

#### 1. Rewrite `EXTRACT_SYSTEM_PROMPT`
**File**: `src/transcript/extract.ts`

Replace the current prompt with one that includes:

**DO extract** (wiki-worthy):
- Persistent entity descriptions: physical appearance, notable traits, clothing, mannerisms
- Organizational facts: who runs what, factions, hierarchy, purpose, location
- Named places: what they are, who controls them, physical character
- Lore and world-rules: how magic/technology/society works in this setting
- Relationships that persist beyond one session: alliances, enmities, employment, family
- Historical events: things that happened before or during the campaign that shape the world

**DO NOT extract** (non-wiki):
- Scene blocking: who sat where, what someone produced, where people were standing
- Dice roll outcomes and combat blow-by-blow
- Single-session ephemeral events: "the party went to X", "the GM described Y arriving"
- Dialogue paraphrase: restating what someone said without a persistent world fact
- Transient possessions or resources: "Benny had 3 gold", "the fire extinguisher was red"
- Out-of-character remarks even within IC-labeled segments
- For MIXED segments (should be rare after Phase 1): skip any lines that are clearly OOC
- `combat` segments are never passed to extraction at all — no instruction needed

**Speaker filter rule** (add to the prompt):
> Extract claims only from lines spoken by the **Gamemaster**. Exception: in segments labeled `RECAP`, player lines are also valid sources because they are recounting established prior-session canon.

The unit label passed in the user message (already done at `extract.ts:172`) tells the model which rule applies.

#### 2. Post-hoc speaker enforcement in `repairAndValidateClaim`
**File**: `src/transcript/extract.ts`

After the existing role recomputation (step 4), add a drop rule:
```ts
// Drop player claims from non-recap segments.
if (repairedRole === 'player' && unit.label !== 'recap') {
  return { claim: null, repaired: false, dropReason: 'player claim in non-recap segment' };
}
```

This acts as a hard backstop even if the prompt doesn't fully comply.

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/extract.test.ts` — all existing tests pass; update any fixtures that assumed player claims from IC segments
- [x] New unit test: feed an IC unit with a mix of GM and player lines; assert only GM-attributed claims survive
- [x] New unit test: feed a RECAP unit with player lines; assert player claims are kept
- [x] `bun run typecheck` passes

#### Manual Verification
- [ ] After running extract on `2025-8-28`, confirm 0 claims with `role === 'player'` and `sourceSegmentLabel !== 'recap'` in the output
- [ ] Spot-check 20 surviving claims: none should be scene-blocking or dialogue paraphrase

---

## Phase 3: Post-Extraction Worthiness Filter

### Overview

New module `src/transcript/worthiness.ts`. After extraction, batch claims through a cheap Haiku call with a binary `wiki`/`transcript` classifier. Drop `transcript` claims inline. Write pre-filter claims to a debug file for audit.

### Changes Required

#### 1. New module
**File**: `src/transcript/worthiness.ts` (new)

```ts
export interface WorthinessResult {
  kept: Claim[];
  dropped: Claim[];
}
```

`filterByWorthiness(claims, opts)`:
- Batches 20 claims per Haiku call.
- System prompt (cached): rubric matching the DO/DO NOT list from Phase 2, framed as a classifier. For each claim (by index) emit `{ index: number, verdict: 'wiki' | 'transcript' }`.
- Drops any claim whose verdict is `transcript`.
- Returns `{ kept, dropped }`.

#### 2. Wire into `extractTranscript`
**File**: `src/transcript/extract.ts`

After assembling `allClaims`, call `filterByWorthiness`. Add `filteredCount` to `ExtractTranscriptResult`. The caller (CLI) logs this.

The worthiness filter needs a `model` param — add `worthinessModel?: string` to `ExtractTranscriptOptions`; default to `MODEL_EXTRACT` (callers can override to Haiku via env).

#### 3. Debug output
**File**: `src/cli/extract.ts`

Before writing the final claims JSON, write pre-filter claims to `state/claims/_debug/<filename>.json`. This file is gitignored (add `state/claims/_debug/` to `.gitignore`) but stays on disk for manual audit.

#### 4. Config
**File**: `src/config.ts`

Add `MODEL_FILTER: 'claude-haiku-4-5-20251001'` to defaults and `Config` interface. The worthiness model reads from this key.

#### 5. CLI log line
**File**: `src/cli/extract.ts`

```
extracted foo.txt: 180 claims kept (534 raw → 354 player-filtered → 180 after worthiness filter), 12 repaired, 8 dropped-invalid
```

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/worthiness.test.ts` — new tests: pass 5 obviously-wiki claims and 5 obviously-not; assert correct split
- [x] `bun test src/cli/extract.test.ts` — existing tests pass; update if fixtures changed
- [x] `state/claims/_debug/` excluded from git: `git check-ignore state/claims/_debug/` exits 0
- [x] `bun run typecheck` passes

#### Manual Verification
- [ ] Spot-check 10 dropped claims in the debug file: confirm they were genuinely not wiki-worthy
- [ ] Spot-check 10 kept claims: confirm they are genuine worldbuilding facts

---

## Phase 4: Reset State and End-to-End Validation

### Overview

Invalidate all segment and claim outputs produced under the old logic, then re-run the full pipeline on a single transcript to validate the changes before committing to the full batch.

### Changes Required

#### 1. Reset ledger for all transcripts (segmented stage cascades forward)
```
bun run transcripts reset --all segmented
```
This clears `segmented`, `extracted`, `matched`, `proposed`, `verified`, `prOpened` for all entries (using the existing `resetEntryStage` cascade logic).

#### 2. Delete stale state files
```
rm state/segments/*.json
rm state/claims/*.json
rm -rf state/claims/_debug/
rm state/matches/*.json
```

#### 3. Re-run pipeline on one transcript
```
bun run segment 2025-8-28
bun run extract 2025-8-28
bun run match   2025-8-28
```

### Success Criteria

#### Automated Verification
- [x] `state/segments/000.through-a-song-darkly.2025-8-28.txt.json` exists, `mixed` count = 0, at least 1 `combat` segment present (7 combat, 0 mixed)
- [x] `state/claims/000.through-a-song-darkly.2025-8-28.txt.json` exists; `claims.filter(c => c.role === 'player').length === 0` (no player claims from IC segments)
- [x] `state/matches/000.through-a-song-darkly.2025-8-28.txt.json` exists
- [x] Total claim count is substantially lower than the original 534 (96 kept vs original ~534)
- [x] `bun test` — full suite passes (199/199)

#### Manual Verification
- [ ] Open `state/claims/000.through-a-song-darkly.2025-8-28.txt.json`, read through 30 random claims — all should be entity descriptions, lore, organizational facts, or world history; none should be scene-blocking
- [ ] Open `state/claims/_debug/` debug file, sample 10 dropped claims — confirm they were correctly filtered
- [ ] Compare segment file: confirm refined blocks split cleanly at IC/OOC boundaries

---

## Testing Strategy

### Unit Tests
- `segment.test.ts`: add a fixture for a known mixed block; assert refinement produces 0 mixed segments; add combat fixture
- `extract.test.ts`: update fixtures that assumed player claims in IC units; add recap-player test; confirm combat units never enter `buildExtractionUnits`
- `worthiness.test.ts` (new): batch classifier with obvious keep/drop examples

### Integration
- Phase 4 is the integration test: full pipeline on one transcript, manual inspection of outputs

### Regression
- `bun test` must pass after each phase before moving on

---

## Performance Considerations

Net cost impact is roughly neutral or slightly cheaper per transcript:
- Phase 1 adds ~$0.02/transcript (Haiku re-segmentation of mixed blocks)
- Phase 2 reduces extract output tokens ~15–20% by suppressing player claims
- Phase 3 adds ~$0.01/transcript for the Haiku filter but substantially reduces claim volume going into match, likely saving ~$0.25–$0.35/transcript on match costs

---

## References

- Original ticket: `tickets/014-stakeholder-requests.md`
- Segmenter: `src/transcript/segment.ts` — `LABELS` at line 5, `SEGMENT_SYSTEM_PROMPT` at line 33
- Extractor: `src/transcript/extract.ts` — speaker repair at line 244, prompt at line 122
- Classifier: `src/reconcile/classify.ts`
- Ledger reset: `src/transcript/ledger.ts:resetEntryStage`
- Config defaults: `src/config.ts`
