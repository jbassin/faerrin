# Claim Extraction Implementation Plan

## Overview

Second per-transcript LLM pass. For each `ic`, `recap`, and `mixed` segment produced by ticket 006, chunk large segments with the existing `chunkTranscript` utility, call Sonnet 4.6 per chunk with a cached claim-extraction rubric, validate and repair each claim against the actual line prefixes, dedupe across chunk overlaps, and persist atomic factual claims to `state/claims/<filename>.json`. On success, mark `stages.extracted` in the ledger.

Claims feed directly into ticket 008 (claim-to-page matching).

## Current State Analysis

Ticket 006 is complete. All 37 transcripts have segment files in `state/segments/`. The pipeline foundation from tickets 002–006 provides everything needed:

- **LLM wrapper** (`src/llm.ts:33`): `complete()` supports a cached system block, schema-validated tool-use, `temperature: 0`, automatic per-call cost logging.
- **`MODEL_EXTRACT`** (`src/config.ts:5`): already defaults to `claude-sonnet-4-6`, overridable via env var.
- **Chunker** (`src/transcript/chunk.ts:21`): `chunkTranscript(text, opts?)` produces overlapping windows with absolute 1-based line numbers. Will be reused to handle long IC stretches.
- **Ledger** (`src/transcript/ledger.ts`): `extracted` is already in `STAGE_ORDER` (index 1, after `segmented`). `markStage`, `recordError`, `findEntry`, `readLedger`, `writeLedger`, `reconcile` all ready.
- **CLI pattern** (`src/cli/segment.ts`): the reconcile → find/dispatch → atomic-write → markStage → summary shape will be mirrored almost verbatim.
- **Segment output format** (`state/segments/<filename>.json`): `{filename, contentHash, totalLines, windowCount, segments: [{startLine, endLine, label, confidence, oneLineSummary}]}`. Source transcripts have `000123\t<Speaker>: <text>` per line, so speaker names are trivially parseable.
- **Pricing** (`src/pricing.ts:9`): Sonnet at $3.00/M input, $0.30/M cache-read, $3.75/M cache-write, $15.00/M output. `costUSD` handles unknown models gracefully.

What's missing: the speaker-parsing utility, extraction-unit builder, extractor core (schema + prompt + LLM call + repair), and CLI command.

## Desired End State

After this ticket:

- `bun run extract 000.through-a-song-darkly.2025-8-28` reads the segments file, chunks IC/recap/mixed segments, calls Sonnet 4.6 per chunk, and writes `state/claims/000.through-a-song-darkly.2025-8-28.txt.json` containing every atomic factual claim from that transcript sorted by start line, then marks `stages.extracted`.
- `bun run extract --all` does the same for every transcript whose `stages.segmented` is set and `stages.extracted` is null.
- Every claim has a `role` field derived deterministically from the cited line prefixes (not the LLM's judgment); claims where the named speaker doesn't appear in the cited line range are dropped.
- Chunk overlap deduplication ensures no claim is double-counted when a long segment spans multiple extraction windows.
- Raw per-chunk LLM output is written to `state/claims/_debug/<filename>/<start>-<end>.json` for spot-checking (gitignored).
- Running twice on the same transcript produces byte-identical output (Sonnet at `temperature: 0`, deterministic post-processing).

### Key Discoveries

- The transcript line prefix `000123\t<Speaker>: <text>` is parseable with a simple regex: `/^(\d{6})\t([^:]+):\s/`. Line numbers in the prefix are 1-based and match the 1-based `startLine`/`endLine` used throughout the pipeline. (`transcripts/000.through-a-song-darkly.2025-8-28.txt:1`)
- `chunkTranscript` takes raw text and produces windows with 1-based `startLine`/`endLine` **relative to that text**. When we slice a segment's lines from the full transcript, we must add `segment.startLine - 1` to every chunk's bounds to get absolute line numbers. (`src/transcript/chunk.ts:21`)
- The ledger's `stages.segmented` timestamp being non-null is a reliable signal that a segments file exists and is valid. We don't need a separate file-existence check if we filter on that. (`src/transcript/ledger.ts:5`)
- The segment file carries `contentHash` (the transcript's hash at the time of segmentation). If this mismatches the current ledger entry's `contentHash`, the transcript changed after segmenting — we should error and tell the user to `bun run transcripts reset <name> --stage segmented`. (`state/segments/*.json`, `src/transcript/ledger.ts:100`)
- `mixed` segments are included per user decision, with a prompt note that much of the content may be OOC noise. The rubric instructs the model to skip non-IC/recap portions within mixed segments.
- Overlap deduplication is done by "primary half" rule: for a given chunk that is not the first window of a segment, drop claims whose `lines[0]` falls in the leading overlap zone (i.e., `lines[0] < chunk.startLine + overlapLines`). The overlap exists for context, not coverage.

## What We're NOT Doing

- No claim deduplication across transcripts — that's ticket 008's job.
- No matching claims to wiki pages — ticket 008.
- No `--force` flag. Re-extracting requires `bun run transcripts reset <name> --stage extracted`.
- No parallel LLM calls — sequential, same as the segment stage.
- No streaming or batch API.
- No retry loop on validation failures — bad claims are dropped and logged; the run continues.
- No re-validation that segment labels are correct — we trust ticket 006's output.
- No filtering to main-campaign transcripts only — side campaigns are extracted too.

## Implementation Approach

Four phases that build cleanly on each other. Phases 1–3 have no live LLM calls and are fully unit-testable. Phase 4 is the first phase that burns API tokens.

1. **Speaker parsing utility** — pure, no LLM, unit-tested.
2. **Extraction-unit builder** — pure, no LLM, unit-tested.
3. **Extractor core** — schema, prompt, LLM call, repair, dedup; tested with injected `completeFn`.
4. **CLI + persistence** — wire phases 1–3, atomic JSON write, ledger mutations, debug output.

---

## Phase 1: Speaker Parsing Utility

### Overview

A small pure-function module that parses `Speaker:` prefixes from transcript lines. Used in phase 3 to recompute `role` deterministically and to validate that a named speaker appears in a claim's cited line range. No LLM, no IO.

### Changes Required

#### 1. New file: `src/transcript/speakers.ts`

**Changes**:

```ts
// Matches "000123\tSpeaker Name: rest of line"
const LINE_RE = /^\d{6}\t([^:]+):\s/;

export interface SpeakerLine {
  line: number;    // 1-based transcript line number
  speaker: string; // e.g. "Gamemaster", "Argyle", "Johnny"
}

/**
 * Parse speaker prefixes from raw transcript text.
 * Lines that don't match the prefix pattern are skipped (blank lines, etc.).
 */
export function parseSpeakers(text: string): SpeakerLine[] {
  const out: SpeakerLine[] = [];
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(LINE_RE);
    if (m) out.push({ line: i + 1, speaker: m[1]!.trim() });
  }
  return out;
}

/**
 * Return the set of distinct speaker names present in [startLine, endLine] inclusive (1-based).
 */
export function speakersInRange(
  speakerLines: SpeakerLine[],
  startLine: number,
  endLine: number,
): Set<string> {
  const out = new Set<string>();
  for (const { line, speaker } of speakerLines) {
    if (line >= startLine && line <= endLine) out.add(speaker);
  }
  return out;
}

/**
 * True if "Gamemaster" appears as a speaker in [startLine, endLine].
 */
export function gmPresent(
  speakerLines: SpeakerLine[],
  startLine: number,
  endLine: number,
): boolean {
  return speakersInRange(speakerLines, startLine, endLine).has('Gamemaster');
}
```

#### 2. Tests: `src/transcript/speakers.test.ts`

- `parseSpeakers` on a 5-line snippet returns `SpeakerLine[]` with the right speaker names and 1-based line numbers.
- Lines without a matching prefix (blank lines, lines with no tab) are skipped — no crash.
- `speakersInRange` returns the correct set for a sub-range.
- `gmPresent` returns `true` when `Gamemaster:` appears in range, `false` otherwise.
- Multi-word speaker names like `Killer Instinct` are preserved verbatim (the regex stops at the first `:` that is followed by whitespace).

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/speakers.test.ts` passes
- [x] `bun run typecheck` passes

---

## Phase 2: Extraction-Unit Builder

### Overview

Converts a parsed segments file + raw transcript text into a flat list of "extraction units" — one per LLM call. Each eligible segment (label `ic`, `recap`, or `mixed`) is chunked with the existing `chunkTranscript` utility at 400-line windows with 40-line overlap. Short segments that fit in one window produce one unit. Each unit carries absolute transcript line numbers and knows whether it is the first window of its segment (needed for overlap deduplication in phase 3).

### Changes Required

#### 1. New types and builder in `src/transcript/extract.ts` (created in phase 3; scaffolded here)

**File**: `src/transcript/extract.ts` (new, partial — phase 3 fills in the rest)

```ts
import { chunkTranscript } from './chunk';
import type { Segment } from './segment';

export const EXTRACT_LABELS = ['ic', 'recap', 'mixed'] as const;
export type ExtractLabel = (typeof EXTRACT_LABELS)[number];

export interface ExtractionUnit {
  sourceSegmentStartLine: number;  // startLine of the parent segment
  label: ExtractLabel;
  startLine: number;               // absolute, 1-based, inclusive
  endLine: number;                 // absolute, 1-based, inclusive
  text: string;                    // raw transcript lines including "000123\t..." prefix
  isFirstWindowOfSegment: boolean;
  overlapLines: number;            // how many lines at the start are overlap from prior window
}

export interface BuildUnitsOptions {
  windowLines?: number;   // default 400
  overlapLines?: number;  // default 40
}

/**
 * Build extraction units from a segments file + the full transcript text.
 * Only ic/recap/mixed segments are included. Long segments are chunked;
 * short ones produce a single unit.
 */
export function buildExtractionUnits(
  transcriptLines: string[],  // pre-split, 0-indexed; no trailing empty entry
  segments: Segment[],
  opts: BuildUnitsOptions = {},
): ExtractionUnit[] {
  const windowLines  = opts.windowLines  ?? 400;
  const overlapLines = opts.overlapLines ?? 40;
  const units: ExtractionUnit[] = [];

  for (const seg of segments) {
    if (!(EXTRACT_LABELS as readonly string[]).includes(seg.label)) continue;
    const label = seg.label as ExtractLabel;

    // Slice the segment's raw lines (0-indexed array → seg is 1-based).
    const slice = transcriptLines.slice(seg.startLine - 1, seg.endLine);
    const sliceText = slice.join('\n');

    const { windows } = chunkTranscript(sliceText, { windowLines, overlapLines });

    for (let wi = 0; wi < windows.length; wi++) {
      const w = windows[wi]!;
      // Remap from slice-relative 1-based to absolute 1-based.
      const absStart = seg.startLine + w.startLine - 1;
      const absEnd   = seg.startLine + w.endLine   - 1;
      const actualOverlap = wi === 0 ? 0 : overlapLines;

      units.push({
        sourceSegmentStartLine: seg.startLine,
        label,
        startLine: absStart,
        endLine: absEnd,
        text: w.text,
        isFirstWindowOfSegment: wi === 0,
        overlapLines: actualOverlap,
      });
    }
  }

  return units;
}
```

#### 2. Tests: `src/transcript/extract.test.ts` (partial — extended in phase 3)

- An `ic` segment of 10 lines with `windowLines: 400` produces exactly one unit with `isFirstWindowOfSegment: true` and `overlapLines: 0`.
- A `recap` segment of 900 lines with `windowLines: 400, overlapLines: 40` produces 3 units; their absolute `startLine`/`endLine` map back correctly into the transcript's 1-based coordinate space.
- An `ooc` segment produces zero units — it's skipped.
- A `mixed` segment is included.
- The `text` of each unit, when split on `\n` and inspected for the `000NNN\t` prefix, starts at the correct absolute line number.
- Two adjacent segments each produce independent unit lists (no cross-segment merging).

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/extract.test.ts` passes (partial suite; extended in phase 3)
- [x] `bun run typecheck` passes

---

## Phase 3: Extractor Core

### Overview

The LLM call layer. Defines the claim schema, the cached system prompt, the per-unit `extractUnit()` function, the `repairAndValidateClaim()` post-processor, and the top-level `extractTranscript()` that ties everything together. Tested entirely with an injected fake `completeFn` — no live API calls needed.

### Changes Required

#### 1. Claim schema, prompt, and core logic in `src/transcript/extract.ts` (continued)

**Claim schema**:

```ts
import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import { parseSpeakers, speakersInRange, gmPresent } from './speakers';

const ClaimSchema = z.object({
  claim:      z.string().min(1),
  lines:      z.tuple([z.number().int().positive(), z.number().int().positive()]),
  speaker:    z.string().min(1),
  role:       z.enum(['gm', 'player']),
  confidence: z.enum(['stated', 'inferred', 'speculative']),
  entities:   z.array(z.string()),
});

const ExtractionOutputSchema = z.object({
  claims: z.array(ClaimSchema),
});

export type RawClaim = z.infer<typeof ClaimSchema>;

export interface Claim extends RawClaim {
  sourceSegmentStartLine: number;
}
```

**Cached system prompt** (assigned to `EXTRACT_SYSTEM_PROMPT`):

```
You are extracting atomic factual claims from Pathfinder 2e tabletop campaign session transcripts.

Each chunk of transcript you receive contains lines in the format:
  000123\tSpeaker Name: dialogue

Extract discrete, atomic factual claims about the game world: named entities, events, relationships,
organizations, places, and facts revealed or established during play. Each claim must be a single
declarative statement that can stand alone as a fact.

DO NOT extract:
- Dice roll results or game mechanics ("rolled a 17", "my AC is 19")
- Rules questions or character-build discussion
- Out-of-character chatter, real-world topics, or jokes
- Player declarations that are clearly hypothetical or rhetorical
- For MIXED segments: skip any lines that appear out-of-character

For each claim emit:
- claim: a single atomic statement in third-person declarative prose
- lines: [startLine, endLine] — the inclusive range of transcript lines that support this claim
  (MUST be 1–20 lines; use the 6-digit prefix numbers)
- speaker: the name of the speaker whose statement is the primary source of the claim
  (match exactly how the name appears after the tab character)
- role: "gm" if the Gamemaster is the primary source, "player" if a player character is
- confidence:
    "stated"      — GM narrates a world fact, or player declares a fact about their own character
    "inferred"    — GM implies something without stating it outright
    "speculative" — player guesses, theorizes, or speculates about the world or NPCs
- entities: array of proper nouns (people, places, organizations, phenomena) mentioned in the claim

IMPORTANT:
- Every claim's lines range must fall within the window you were given.
- No claim's lines range may exceed 20 lines. If a passage spans more, split into smaller claims.
- Do not invent claims not supported by the cited lines.
- If no extractable claims exist in this chunk, emit an empty claims array.
```

**Per-unit extraction**:

```ts
export interface ExtractUnitOptions {
  model: string;
  transcript: string;          // filename, for cost log
  completeFn?: typeof defaultComplete;
}

export async function extractUnit(
  unit: ExtractionUnit,
  opts: ExtractUnitOptions,
): Promise<RawClaim[]> {
  const fn = opts.completeFn ?? defaultComplete;
  const label = unit.label === 'mixed'
    ? 'This segment is labeled MIXED — it interleaves in-character and out-of-character content. Extract claims only from clearly in-character or recap portions.'
    : `This segment is labeled ${unit.label.toUpperCase()}.`;

  const result = await fn({
    stage: 'extract',
    transcript: opts.transcript,
    model: opts.model,
    cached: EXTRACT_SYSTEM_PROMPT,
    user: [
      `Transcript chunk: lines ${unit.startLine}–${unit.endLine}. ${label}`,
      unit.text,
    ].join('\n\n'),
    schema: ExtractionOutputSchema,
    maxTokens: 4096,
  });

  return result.value.claims;
}
```

**Repair and validation**:

```ts
export interface RepairResult {
  claim: Claim | null;  // null = drop
  repaired: boolean;
  dropReason?: string;
}

export function repairAndValidateClaim(
  raw: RawClaim,
  speakerLines: SpeakerLine[],
  unit: ExtractionUnit,
): RepairResult {
  const [start, end] = raw.lines;

  // 1. Clamp lines to the unit's absolute bounds.
  const clampedStart = Math.max(start, unit.startLine);
  const clampedEnd   = Math.min(end,   unit.endLine);
  if (clampedStart > clampedEnd) {
    return { claim: null, repaired: false, dropReason: `lines [${start},${end}] outside unit [${unit.startLine},${unit.endLine}]` };
  }

  // 2. Enforce ≤ 20-line limit.
  if (clampedEnd - clampedStart > 19) {
    return { claim: null, repaired: false, dropReason: `lines span ${clampedEnd - clampedStart + 1} > 20` };
  }

  // 3. Validate speaker appears in cited range.
  const speakers = speakersInRange(speakerLines, clampedStart, clampedEnd);
  if (!speakers.has(raw.speaker)) {
    return { claim: null, repaired: false, dropReason: `speaker '${raw.speaker}' not found in lines ${clampedStart}–${clampedEnd}` };
  }

  // 4. Recompute role from prefixes (overrides LLM judgment).
  const repairedRole: 'gm' | 'player' = gmPresent(speakerLines, clampedStart, clampedEnd)
    ? 'gm'
    : 'player';
  const repaired = repairedRole !== raw.role || clampedStart !== start || clampedEnd !== end;

  const claim: Claim = {
    ...raw,
    lines: [clampedStart, clampedEnd],
    role: repairedRole,
    sourceSegmentStartLine: unit.sourceSegmentStartLine,
  };

  return { claim, repaired };
}
```

**Overlap deduplication**:

Claims from a non-first window whose `lines[0]` falls within the leading overlap zone of that window are dropped. The overlap zone of window `wi` (with `overlapLines = 40`) runs from `unit.startLine` to `unit.startLine + overlapLines - 1`. The assumption: the prior window already captured those lines as its primary half.

```ts
function isInOverlapZone(claim: Claim, unit: ExtractionUnit): boolean {
  if (unit.isFirstWindowOfSegment) return false;
  return claim.lines[0] < unit.startLine + unit.overlapLines;
}
```

**Top-level entrypoint**:

```ts
export interface ExtractTranscriptOptions {
  model: string;
  transcript: string;
  windowLines?: number;
  overlapLines?: number;
  completeFn?: typeof defaultComplete;
  onChunkComplete?: (unit: ExtractionUnit, rawClaims: RawClaim[], kept: Claim[]) => void;
}

export interface ExtractTranscriptResult {
  claims: Claim[];     // sorted by lines[0] ascending
  unitCount: number;
  droppedCount: number;
  repairedCount: number;
}

export async function extractTranscript(
  text: string,
  segments: Segment[],
  opts: ExtractTranscriptOptions,
): Promise<ExtractTranscriptResult> {
  const transcriptLines = text.split('\n');
  if (transcriptLines.length > 0 && transcriptLines[transcriptLines.length - 1] === '') {
    transcriptLines.pop();
  }
  const speakerLines = parseSpeakers(text);
  const units = buildExtractionUnits(transcriptLines, segments, {
    windowLines: opts.windowLines,
    overlapLines: opts.overlapLines,
  });

  const allClaims: Claim[] = [];
  let droppedCount = 0;
  let repairedCount = 0;

  for (const unit of units) {
    const raw = await extractUnit(unit, {
      model: opts.model,
      transcript: opts.transcript,
      completeFn: opts.completeFn,
    });

    const kept: Claim[] = [];
    for (const r of raw) {
      const { claim, repaired, dropReason } = repairAndValidateClaim(r, speakerLines, unit);
      if (!claim) {
        droppedCount++;
        console.warn(`extract(${opts.transcript}): dropping claim "${r.claim.slice(0, 60)}…" — ${dropReason}`);
        continue;
      }
      if (isInOverlapZone(claim, unit)) {
        droppedCount++;
        continue;
      }
      if (repaired) repairedCount++;
      kept.push(claim);
    }
    opts.onChunkComplete?.(unit, raw, kept);
    allClaims.push(...kept);
  }

  // Sort by start line; stable on equal start.
  allClaims.sort((a, b) => a.lines[0] - b.lines[0] || a.lines[1] - b.lines[1]);

  return { claims: allClaims, unitCount: units.length, droppedCount, repairedCount };
}
```

#### 2. Tests: `src/transcript/extract.test.ts` (extended from phase 2)

All tests inject a fake `completeFn`. None hit the network.

- **Happy path**: 3-segment transcript (ooc, ic, recap). Fake LLM returns 2 claims per unit. Only ic+recap units are created; output has 4 claims sorted by line.
- **Mixed segment included**: a `mixed` segment generates a unit; user message passed to fake completeFn contains the "MIXED" label notice.
- **Role repair**: fake LLM returns `role: 'player'` for a claim whose cited lines contain `Gamemaster:`. `repairAndValidateClaim` overrides to `'gm'`.
- **Speaker drop**: fake LLM names `speaker: 'Zara'` for lines containing only `Gamemaster` and `Argyle`. Claim is dropped; `droppedCount` incremented.
- **Overlap deduplication**: 900-line IC segment chunked into 3 windows (overlap 40). Fake LLM emits a claim with `lines[0]` in the overlap zone of the second window. That claim is dropped; the same claim from the first window's primary zone is kept.
- **Lines > 20 drop**: fake LLM returns `lines: [100, 125]` (26 lines). Dropped.
- **Lines out-of-unit clamp-drop**: fake LLM returns `lines: [200, 210]` for a unit covering `[300, 400]`. Clamped result has start > end → dropped.
- **Empty result**: fake LLM returns `{ claims: [] }`. No crash; `extractTranscript` returns empty array.
- **`onChunkComplete` callback fires**: verify it receives the raw and kept claims per unit.
- **Sort order**: claims from later units sort correctly after claims from earlier ones.

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/extract.test.ts` passes (full suite)
- [x] `bun test src/transcript/speakers.test.ts` passes
- [x] `bun run typecheck` passes
- [x] All existing tests still pass: `bun test`

---

## Phase 4: CLI Command and Persistence

### Overview

Wire phases 1–3 into `bun run extract`. Handles single-transcript and `--all` modes, reads the segment file, errors if the transcript changed since segmenting, writes claims JSON and per-chunk debug JSON atomically, updates the ledger, and prints a summary line. This is the first phase that burns API tokens.

### Changes Required

#### 1. New CLI handler: `src/cli/extract.ts`

**File**: `src/cli/extract.ts` (new)

```ts
import { mkdir, rename } from 'node:fs/promises';
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError,
  type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { extractTranscript, type Claim, type ExtractionUnit, type RawClaim } from '../transcript/extract';
import type { Segment } from '../transcript/segment';
import { config } from '../config';
import type { complete as defaultComplete } from '../llm';

const TRANSCRIPTS_DIR = 'transcripts';
const LEDGER_PATH     = 'state/processed.json';
const SEGMENTS_DIR    = 'state/segments';
const CLAIMS_DIR      = 'state/claims';

export interface ExtractCliOptions {
  transcriptsDir?: string;
  ledgerPath?: string;
  segmentsDir?: string;
  claimsDir?: string;
  model?: string;
  completeFn?: typeof defaultComplete;
}

export async function extract(argv: string[], opts: ExtractCliOptions = {}): Promise<void> {
  // ... (mirrors segment.ts structure exactly)
}
```

**Behavior mirrors `src/cli/segment.ts`**:

- Reconciles ledger against discovery on every invocation.
- `bun run extract <name>`: resolve via `findEntry`; error if `stages.segmented` is null; error if segments file content hash mismatches ledger entry's `contentHash`; extract and write; `markStage('extracted')`; persist. On failure, `recordError` + persist + exit non-zero.
- `bun run extract --all`: iterate entries where `stages.segmented` is non-null AND `stages.extracted` is null AND file is on disk. Sequential. Persist ledger after each success or failure. Print summary at end; exit non-zero if any failed.
- No `--force`.

**Pre-extraction guard** (stale segment detection):

```ts
const segFile = Bun.file(`${ctx.segmentsDir}/${entry.filename}.json`);
if (!(await segFile.exists())) {
  throw new Error(`segments file missing — run 'bun run segment ${entry.filename}' first`);
}
const segData = JSON.parse(await segFile.text());
if (segData.contentHash !== entry.contentHash) {
  throw new Error(
    `transcript changed since segmentation — run 'bun run transcripts reset ${entry.filename} --stage segmented' then re-segment before extracting`,
  );
}
```

**Output JSON shape** (`state/claims/<filename>.json`):

```json
{
  "filename": "000.through-a-song-darkly.2025-8-28.txt",
  "contentHash": "76456b04...",
  "segmentsContentHash": "76456b04...",
  "totalLines": 3981,
  "unitCount": 8,
  "droppedCount": 3,
  "repairedCount": 5,
  "coverage": {
    "lines": 2840,
    "percentOfTranscript": 71
  },
  "claims": [
    {
      "claim": "Captain Vey serves the Iron Synod",
      "lines": [1820, 1822],
      "speaker": "Gamemaster",
      "role": "gm",
      "confidence": "stated",
      "entities": ["Captain Vey", "Iron Synod"],
      "sourceSegmentStartLine": 1800
    }
  ]
}
```

Coverage: `lines` = total unique transcript lines covered by extraction units (deduped); `percentOfTranscript` = `Math.round(lines / totalLines * 100)`.

Written via atomic tmp-rename, matching `writeLedger`'s pattern (`src/transcript/ledger.ts:67`).

**Debug output** (`state/claims/_debug/<filename>/<start>-<end>.json`, gitignored):

One file per extraction unit, written via the `onChunkComplete` callback:

```json
{
  "unit": { "sourceSegmentStartLine": 1800, "label": "ic", "startLine": 1800, "endLine": 2199, "isFirstWindowOfSegment": true, "overlapLines": 0 },
  "rawClaims": [ /* exactly what the LLM returned */ ],
  "keptClaims": [ /* after repair/drop/dedup */ ]
}
```

Directory created with `mkdir({ recursive: true })` before first write.

**CLI summary line** (printed per transcript):

```
extracted 000.through-a-song-darkly.2025-8-28.txt: 47 claims from 8 units covering 2840 lines (71% of transcript) — 3 dropped, 5 role-repaired
```

#### 2. Register in CLI map: `src/cli/index.ts`

```ts
import { extract } from './extract';

export const handlers: Record<string, CliHandler> = {
  // existing entries unchanged
  'extract': extract,
};
```

#### 3. Add script: `package.json`

```json
"extract": "bun index.ts extract"
```

#### 4. Gitignore debug directory: `.gitignore`

Add `state/claims/_debug/`. The `state/claims/` root itself is **not** gitignored — committed outputs follow the same convention as `state/segments/`.

#### 5. CLI tests: `src/cli/extract.test.ts`

Use an injected fake `completeFn` and tmp directories for all state. Cover:

- Single-transcript run writes `state/claims/<name>.json`, sets `stages.extracted`, ledger persists.
- `--all` skips transcripts whose `stages.extracted` is already set.
- `--all` skips transcripts whose `stages.segmented` is null (not yet segmented).
- `--all` continues past a single-transcript failure, records the error, exits non-zero at end.
- Stale segment detection: segments file `contentHash` doesn't match ledger → throws with helpful message; ledger records the error.
- Missing segments file → throws with helpful message.
- Output JSON passes JSON.parse without error and has `claims` array sorted by `lines[0]`.
- Running twice on the same transcript with a deterministic fake LLM produces byte-identical `claims/<name>.json`.
- Debug files are written to `_debug/<filename>/<start>-<end>.json` for each unit.
- `coverage.percentOfTranscript` is correct for a small synthetic transcript.

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/extract.test.ts` passes
- [x] All tests pass: `bun test`
- [x] Type check passes: `bun run typecheck`
- [x] `bun run extract` with no args prints usage and exits non-zero
- [x] Running `bun run extract <name>` twice on the same transcript produces byte-identical `state/claims/<name>.json`

#### Manual Verification
- [ ] `bun run extract 000.through-a-song-darkly.2025-8-28` runs without error; output JSON is valid and claims are plausible on spot-check
- [ ] Spot-check 10 claims: every one is supported by the lines it cites (view those lines in the transcript)
- [ ] `role: 'gm'` claims all cite lines where `Gamemaster:` appears
- [ ] `bun run cost-report` shows the `extract` stage for that transcript; cost is reasonable (expect ~$0.30–$1.00 per transcript)
- [ ] `state/claims/_debug/` contains one file per extraction unit
- [ ] `bun run transcripts list` shows `ext` column set for processed transcripts
- [ ] `bun run extract --all` runs to completion; print a final line count per transcript

**Implementation Note**: Run on one transcript and hand-check before running `--all`.

---

## Testing Strategy

### Unit Tests

- **Phase 1 — speakers**: prefix regex, range queries, GM detection, multi-word speaker names, lines with no match.
- **Phase 2 — unit builder**: segment filtering (only ic/recap/mixed), chunk sizing, absolute-coordinate mapping, overlap tracking, adjacent-segment independence.
- **Phase 3 — extractor core**: happy path, mixed-label routing, role repair, speaker drop, lines-too-long drop, overlap dedup, out-of-unit clamp/drop, empty result, sort order.
- **Phase 4 — CLI**: all cases above under CLI heading.

### Integration Tests

The CLI tests in phase 4 are the integration tests — they exercise speaker parsing → unit building → extraction → repair → CLI → ledger + JSON persistence end-to-end with an injected fake `complete()`.

### Manual Testing Steps

1. `bun run extract 000.through-a-song-darkly.2025-8-28` — run; scan `state/claims/000.through-a-song-darkly.2025-8-28.txt.json`.
2. Open 10 random claims; cross-reference each claim's `lines` in the raw transcript file. Every claim should be clearly supported.
3. Filter claims by `role: 'gm'` — verify each cites a line where `Gamemaster:` appears.
4. Check `droppedCount` in the JSON. If >10% of raw claims are dropped, inspect the debug files for systematic issues.
5. `bun run cost-report` — confirm extract stage cost per transcript.
6. `bun run extract --all` (after eyeball check passes).
7. `bun run transcripts list` — confirm all 37 transcripts show `✓` under `ext`.

---

## Performance Considerations

- **Cost estimate**: A typical transcript has ~2500 lines of IC/recap. At 400-line windows, ~7 units. Per unit with caching: ~8K tokens in (cached rubric ~700 tokens) + ~2K tokens out ≈ `7600 * $3/M + 700 * $0.30/M + 2000 * $15/M` ≈ $0.053. Per transcript (7 units, first unit pays cache-write, rest cache-read): first unit ~`700 * $3.75/M + 7600 * $3/M + 2K * $15/M` ≈ $0.056; subsequent 6 units each ~$0.053. Total per transcript: ~$0.37. Across 37 transcripts: ~$14. Run `bun run cost-report` after the first transcript to calibrate before `--all`.
- **Cache efficiency**: the cached system prompt (~700 tokens) is written once per transcript and read for all subsequent units. With 7 units per transcript, ~86% of prompt-rubric tokens hit cache-read pricing.
- **Wall-clock**: ~7 units × 37 transcripts = ~259 calls. At ~4s each (Sonnet is slower than Haiku): ~17 minutes for `--all`. Sequential is correct; no rate-limit headaches.
- **Debug file volume**: ~259 files at ~5–10KB each ≈ ~2MB total. Negligible. Gitignored.

## Migration Notes

None. This adds a new stage between `segmented` and `matched`. Existing segment files are the input; existing ledger entries gain a populated `extracted` timestamp. No existing data needs to move or be reformatted.

## References

- Original ticket: `tickets/007-claim-extraction.md`
- Parent epic: `tickets/001-create-project.md`
- Next ticket: `tickets/008-claim-to-page-matching.md`
- Previous plan: `thoughts/shared/plans/2026-05-17-006-transcript-segmentation.md`
- LLM wrapper: `src/llm.ts:33`
- Chunker (reused): `src/transcript/chunk.ts:21`
- Segment CLI (pattern to mirror): `src/cli/segment.ts:1`
- Cached-prompt + structured-output precedent: `src/wiki/summarize.ts:51`
- Ledger mutators: `src/transcript/ledger.ts:157` (`markStage`), `src/transcript/ledger.ts:165` (`recordError`)
- Pricing table: `src/pricing.ts:9`
- Segment output sample: `state/segments/000.through-a-song-darkly.2025-8-28.txt.json`
- Transcript format sample: `transcripts/000.through-a-song-darkly.2025-8-28.txt`
