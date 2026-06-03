# Transcript Segmentation Implementation Plan

## Overview

First per-transcript LLM pass. Split each transcript into overlapping windows, ask Haiku 4.5 to label every line range as one of `ooc | recap | ic | rules | mixed` with a confidence and one-line summary, then stitch the windows together so every line ends up in exactly one segment. Only `ic` and `recap` will flow into ticket 007 (claim extraction).

Output lands at `state/segments/<filename>.json` and the ledger entry's `stages.segmented` timestamp is set on success.

## Current State Analysis

The pipeline foundation is in place from tickets 002–005:

- **LLM wrapper** (`src/llm.ts:33`): `complete()` already supports a `cached` system block (`cache_control: { type: 'ephemeral' }`), zod-schema-validated tool-use output, `temperature: 0` for determinism, and automatic per-call cost logging via `recordLLMCall` (`src/llm.ts:74`).
- **Config** (`src/config.ts:5`): `MODEL_SEGMENT` defaults to `claude-haiku-4-5-20251001` and is overridable via env var. Pricing is registered in `src/pricing.ts:10` ($1.00/M input, $0.10/M cache-read, $1.25/M cache-write, $5.00/M output).
- **Ledger** (`src/transcript/ledger.ts:157`): `markStage(ledger, filename, 'segmented')` and `recordError(ledger, filename, 'segmented', msg)` are already available. `findEntry` does the exact/substring lookup that other CLIs use.
- **Discovery** (`src/transcript/discover.ts:42`): `discoverTranscripts` returns parsed `TranscriptFile[]` sorted by `(campaignId, sessionDate)`.
- **CLI wiring** (`src/cli/index.ts:8`): Each subcommand is a handler function registered in a map, and `package.json:5` adds a matching script. Existing patterns to mirror: `src/cli/transcripts.ts:16` (reconcile-then-act, find-by-name) and `src/cli/index-wiki.ts:7` (force/check/no-llm flags).
- **Summarize precedent** (`src/wiki/summarize.ts:51`): Shows the exact prompt-caching + structured-output shape we should mirror — `cached: SYSTEM_PROMPT`, `schema: SummarySchema`, per-page work skipped when already done.

Transcript shape: physical files contain `<6-digit-line-num>\t<speaker>: <text>` per line. Average ~4,000 lines (range 2,661–4,830); 26 main + 11 side = 37 transcripts; 146,791 total lines.

What's missing: the chunker, the segmenter (system prompt + per-window call + stitching), the `state/segments/` output, and the `segment` CLI command.

## Desired End State

After this ticket:

- `bun run segment 000.through-a-song-darkly.2025-8-28` writes `state/segments/000.through-a-song-darkly.2025-8-28.txt.json` containing a complete, gap-free, non-overlapping list of labeled line ranges covering the entire transcript, and updates the ledger entry's `stages.segmented` timestamp.
- `bun run segment --all` does the same for every transcript whose `stages.segmented` is `null`, printing a one-line summary per transcript and skipping already-segmented ones.
- Two runs back-to-back on the same transcript produce byte-identical JSON output (LLM is `temperature: 0`, deterministic stitching).
- Per-transcript cost (visible in the run's JSONL via `bun run cost-report`) is at or under ~$0.10 with prompt caching on.

### Key Discoveries

- The cached system block is shared across all windows of a single transcript run, so the rubric is paid once at cache-write rate and re-read at cache-read rate for the remaining ~10–12 windows per transcript. (`src/llm.ts:38`)
- Cost logging is automatic — calling `complete()` is sufficient; no per-call accounting needed in segment.ts. (`src/llm.ts:74`)
- The transcript's on-disk line numbering (`000123\t…`) is 1:1 with the 1-based file line index, so we can use either as the canonical line ID; we use the file line index throughout and pass the raw prefix-included slice to the LLM (per design decision Q4).
- Ledger lookup (`findEntry`, `src/transcript/ledger.ts:136`) accepts substring matches, so `bun run segment 2025-8-28` should resolve unambiguously for any transcript whose filename contains that fragment.

## What We're NOT Doing

- No filtering by label yet — ticket 007 reads the `state/segments/*.json` and chooses what to forward.
- No re-segmentation when only the segment schema changes — `bun run transcripts reset <name> --stage segmented` is the existing escape hatch.
- No multi-LLM disagreement detection (e.g. running two models and comparing). Confidence comes solely from the model's self-reported `confidence` field.
- No streaming or batch API — same one-shot pattern as wiki summarize.
- No `--force` flag on `segment --all`. Re-segmenting uses the existing ledger reset path.
- No UI/dashboard. CLI output only.

## Implementation Approach

Three phases that build on each other and can each be verified independently:

1. **Chunker** — pure function, no LLM. Window math, deterministic, fully unit-testable.
2. **Segmenter core** — system prompt, schema, single-window LLM call, and stitching logic. Tested with an injected fake `completeFn` so we don't burn tokens on unit tests.
3. **CLI** — wire phases 1 + 2 into a `bun run segment` command, persist to `state/segments/*.json`, update the ledger, surface errors. Manually verified on real transcripts.

After each phase, the success criteria are independently checkable (no LLM key needed for phases 1–2 tests).

---

## Phase 1: Chunker

### Overview

Pure utility that takes a transcript's raw text and splits it into overlapping windows. No LLM, no IO beyond what the caller passes in. Windows carry the original 1-based line numbers so the segmenter can emit correct `startLine`/`endLine` values without any later offset math.

### Changes Required

#### 1. New file: chunker

**File**: `src/transcript/chunk.ts` (new)

**Changes**: Export `chunkTranscript(text, opts?)` which splits on `\n`, then walks the line array in fixed-size windows with a fixed overlap.

```ts
export interface ChunkOptions {
  windowLines?: number;   // default 400
  overlapLines?: number;  // default 40
}

export interface Window {
  index: number;          // 0-based
  startLine: number;      // 1-based, inclusive
  endLine: number;        // 1-based, inclusive
  text: string;           // joined lines including their on-disk "000123\t…" prefix
}

export interface ChunkResult {
  totalLines: number;
  windows: Window[];
}

export function chunkTranscript(text: string, opts: ChunkOptions = {}): ChunkResult;
```

Behavior:
- Trailing empty line from a final `\n` is dropped so `totalLines` equals what a human counts.
- `overlapLines` must be `< windowLines`; throw otherwise (we'd loop forever).
- For a transcript shorter than `windowLines`, return a single window covering everything.
- For a transcript of `N` lines, the last window's `endLine` is exactly `N` (no out-of-range padding).
- Stride is `windowLines - overlapLines`. Each window's text is `lines.slice(startLine-1, endLine).join('\n')`.

#### 2. Tests

**File**: `src/transcript/chunk.test.ts` (new)

**Changes**:

- `windowLines: 10, overlapLines: 2` on 25-line input produces windows `[1-10], [9-18], [17-25]` (last window is short, ends exactly at 25).
- 5-line input with default opts returns one window `[1-5]`.
- `overlapLines >= windowLines` throws.
- Empty input returns `{ totalLines: 0, windows: [] }`.
- The text of window i contains line number `startLine` as its first line and `endLine` as its last (verified by inspecting the joined prefix).

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/chunk.test.ts` passes
- [x] Type check passes: `bun run typecheck`

#### Manual Verification
- None for this phase — pure code, covered by unit tests.

---

## Phase 2: Segmenter

### Overview

Calls the LLM once per window with a cached system prompt + rubric, validates the structured response with zod, then stitches windows into a single non-overlapping coverage of every line in the transcript.

### Changes Required

#### 1. New file: segmenter

**File**: `src/transcript/segment.ts` (new)

**Changes**:

**Constants and schema**:

```ts
import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import { chunkTranscript, type Window } from './chunk';

export const LABELS = ['ooc', 'recap', 'ic', 'rules', 'mixed'] as const;
export type Label = (typeof LABELS)[number];

export const CONFIDENCES = ['high', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

const RawSegmentSchema = z.object({
  startLine:       z.number().int().positive(),
  endLine:         z.number().int().positive(),
  label:           z.enum(LABELS),
  confidence:      z.enum(CONFIDENCES),
  oneLineSummary:  z.string().max(200),
});

const WindowOutputSchema = z.object({
  segments: z.array(RawSegmentSchema).min(1),
});

export type RawSegment = z.infer<typeof RawSegmentSchema>;
export interface Segment extends RawSegment {}
```

**System + rubric prompt** (single cached block):

```ts
const SEGMENT_SYSTEM_PROMPT = [
  'You are segmenting Pathfinder 2e tabletop campaign session transcripts.',
  'Each window of the transcript is given to you with line numbers (the 6-digit prefix is the absolute line number in the transcript).',
  '',
  'Label every line. Output one or more contiguous segments that, together, cover EXACTLY the line range you were given — no gaps, no overlaps, no lines outside the window.',
  '',
  'Labels:',
  '- ooc:   out-of-character chatter — players discussing real-world things, technical issues, social banter unrelated to the game.',
  '- recap: a player or GM recounting events from a previous session. Usually near the start.',
  '- ic:    in-character play — the GM narrating the world, players speaking or acting as their characters, action resolution.',
  '- rules: rules discussion, dice mechanics, build/character-sheet questions, archetype lookups. Brief asks ("nat 20?", "what\'s my AC?") inside IC play are still IC; only label `rules` when the conversation pauses on mechanics.',
  '- mixed: the range genuinely interleaves two or more of the above and cannot be cleanly split. Use sparingly — prefer splitting into smaller single-label segments when possible.',
  '',
  'Confidence:',
  '- high: the boundaries and label are obvious from the text.',
  '- low:  you are uncertain — typically near a transition, or when OOC chatter intrudes briefly on IC play.',
  '',
  'For each segment also emit a `oneLineSummary` under 200 characters describing what happens in that range.',
  '',
  'IMPORTANT:',
  '- Use the absolute line numbers shown in the 6-digit prefixes.',
  '- Your segments must be contiguous and ordered. The first segment\'s startLine must equal the window\'s first line. The last segment\'s endLine must equal the window\'s last line.',
  '- NEVER invent labels outside the five above. NEVER emit segments outside the window range.',
].join('\n');
```

**Per-window call**:

```ts
export interface SegmentWindowOptions {
  model: string;
  transcript: string;        // filename, for cost log
  completeFn?: typeof defaultComplete;
}

export async function segmentWindow(
  window: Window,
  opts: SegmentWindowOptions,
): Promise<RawSegment[]> {
  const fn = opts.completeFn ?? defaultComplete;
  const result = await fn({
    stage: 'segment',
    transcript: opts.transcript,
    model: opts.model,
    cached: SEGMENT_SYSTEM_PROMPT,
    user: [
      `Window covers lines ${window.startLine}-${window.endLine}.`,
      'Transcript window:',
      window.text,
    ].join('\n\n'),
    schema: WindowOutputSchema,
    maxTokens: 4096,
  });
  return normalizeWindow(result.value.segments, window);
}
```

**`normalizeWindow`**: clamps to window bounds, drops empty/invalid segments (startLine > endLine), sorts by `startLine`, and snap-fills internal gaps by extending the prior segment's `endLine` to `nextSeg.startLine - 1`. Also stretches the first segment back to `window.startLine` and the last forward to `window.endLine` if the model nudged the edges in. Logs a warning to `console.warn` for any fix applied. Returns the cleaned array; throws if it cannot produce a contiguous covering (e.g. zero segments after filtering).

**Stitching**:

```ts
export function stitchSegments(
  windowOutputs: { window: Window; segments: RawSegment[] }[],
  totalLines: number,
): Segment[];
```

Algorithm:
1. For each line `L` in `1..totalLines`, find every window that covers `L` (could be 1 or 2 with default 40-line overlap; the chunker math guarantees `<= 2`).
2. For each covering window, find the segment in that window's output containing `L`. Record `{ window, segment }`.
3. Resolve which label wins for line `L`:
   - If one window has `confidence: 'high'` and the other `'low'`, the high-confidence label wins.
   - If both are the same confidence, the window whose center (`(startLine + endLine) / 2`) is closer to `L` wins; on an exact tie, the lower-index window wins (deterministic).
4. After assigning every line a `(label, confidence, oneLineSummary)` triple, merge consecutive lines that share `(label, confidence, oneLineSummary)` into a single segment. Different summaries cause a split even on the same label — this is intentional: it preserves the model's view that the topic changed.
5. Validate the final list covers `1..totalLines` exactly: first segment's `startLine === 1`, last's `endLine === totalLines`, and `seg[i+1].startLine === seg[i].endLine + 1`. Throw otherwise.

**Top-level entrypoint**:

```ts
export interface SegmentTranscriptOptions {
  model: string;
  transcript: string;                 // filename, passed through to cost log
  windowLines?: number;
  overlapLines?: number;
  completeFn?: typeof defaultComplete;
}

export interface SegmentTranscriptResult {
  segments: Segment[];
  totalLines: number;
  windowCount: number;
}

export async function segmentTranscript(
  text: string,
  opts: SegmentTranscriptOptions,
): Promise<SegmentTranscriptResult>;
```

Loops windows, calls `segmentWindow` on each, then `stitchSegments` over the collected outputs. Returns the full coverage.

#### 2. Tests

**File**: `src/transcript/segment.test.ts` (new)

All tests inject a fake `completeFn` that returns canned `WindowOutputSchema` values keyed by user content; no network.

- **happy path**: 60-line synthetic transcript, two windows `[1-40]` and `[31-60]`, fake LLM returns clean non-overlapping segments per window. `stitchSegments` produces `[1-N]` coverage with the right labels.
- **gap snap-fill**: fake LLM omits a line range inside a window; `normalizeWindow` extends the prior segment to close it; final coverage is gap-free.
- **edge nudging**: fake LLM emits a first segment starting at `window.startLine + 2`; `normalizeWindow` snaps it back to `window.startLine`.
- **tie-break by center**: two windows disagree on a contested overlap line at equal confidence; `stitchSegments` picks the window whose center is closer; on exact center-distance tie, lower-index wins.
- **high-beats-low**: contested line where one window says `(ic, high)` and the other says `(ooc, low)` → `ic` wins regardless of center distance.
- **merge same-label adjacent**: stitching produces `[ic|high|"fight"]` and `[ic|high|"fight"]` from adjacent lines → merged into one segment.
- **different summaries split**: two adjacent `ic|high` segments with different `oneLineSummary` values stay split.
- **coverage validation**: feed `stitchSegments` a deliberately broken window output (segment claiming `endLine > window.endLine`) → throws.
- **zero-segment window**: fake LLM returns `{ segments: [] }` → zod parse error propagates (we don't need to handle this; the schema's `.min(1)` enforces it).

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/segment.test.ts` passes
- [x] Type check passes: `bun run typecheck`
- [x] All existing tests still pass: `bun test`

#### Manual Verification
- None for this phase — covered by unit tests with the injected fake.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3 (which is the first phase to actually spend API tokens).

---

## Phase 3: CLI command and persistence

### Overview

Wire phases 1 + 2 into a `bun run segment` command. Handle the single-transcript and `--all` paths, write per-transcript JSON to `state/segments/`, update the ledger on success, and record an error entry on failure.

### Changes Required

#### 1. New CLI handler

**File**: `src/cli/segment.ts` (new)

**Changes**:

```ts
import { discoverTranscripts } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  markStage, recordError, type Ledger, type LedgerEntry,
} from '../transcript/ledger';
import { segmentTranscript, type Segment } from '../transcript/segment';
import { config } from '../config';

const TRANSCRIPTS_DIR = 'transcripts';
const LEDGER_PATH     = 'state/processed.json';
const SEGMENTS_DIR    = 'state/segments';

export interface SegmentCliOptions {
  transcriptsDir?: string;
  ledgerPath?: string;
  segmentsDir?: string;
  completeFn?: typeof import('../llm').complete;  // for tests
}

export async function segment(argv: string[], opts: SegmentCliOptions = {}): Promise<void> {
  // ... parse argv, reconcile, dispatch to segmentOne or segmentAll
}
```

**Behavior**:

- Reconciles ledger against discovery first (mirrors `transcripts.ts:27`).
- `bun run segment <name>`: resolve via `findEntry`; segment that one transcript; on success, write `state/segments/<filename>.json`, `markStage(..., 'segmented')`, persist ledger. On failure, `recordError(..., 'segmented', err.message)`, persist ledger, exit non-zero.
- `bun run segment --all`: iterate ledger entries that are still on disk AND have `stages.segmented === null`. Sequential (not parallel — keeps API usage predictable and matches existing pattern). After each transcript, persist the ledger so a crash mid-run doesn't lose progress. Print a per-transcript line: `segmented <filename>: N segments (X ic, Y ooc, …)`. At end, print totals and exit non-zero if any transcript errored.
- No `--force`. Re-segmenting requires `bun run transcripts reset <name> --stage segmented`.

**Output JSON shape**:

```json
{
  "filename": "000.through-a-song-darkly.2025-8-28.txt",
  "contentHash": "…",
  "totalLines": 3981,
  "windowCount": 11,
  "segments": [
    { "startLine": 1, "endLine": 587, "label": "ooc", "confidence": "high", "oneLineSummary": "..." },
    { "startLine": 588, "endLine": 745, "label": "recap", "confidence": "high", "oneLineSummary": "..." },
    ...
  ]
}
```

Stored with `JSON.stringify(payload, null, 2) + '\n'`. `contentHash` written so we can detect a stale segment file (transcript changed after segmenting). Written via `Bun.write` to a `.tmp` path and renamed atomically, mirroring `writeLedger` (`src/transcript/ledger.ts:67`).

#### 2. Register in CLI map and package.json

**File**: `src/cli/index.ts`

**Changes**:

```ts
import { segment } from './segment';

export const handlers: Record<string, CliHandler> = {
  // ...existing...
  'segment': segment,
};
```

**File**: `package.json`

**Changes**: add `"segment": "bun index.ts segment"` to `scripts`.

#### 3. CLI tests

**File**: `src/cli/segment.test.ts` (new)

Use an injected fake `completeFn` and a temp directory for ledger/segments output. Cover:

- Single-transcript run writes `state/segments/<name>.json` and sets `stages.segmented`.
- `--all` skips transcripts whose `stages.segmented` is already set.
- `--all` continues past a single-transcript failure, recording the error and exiting non-zero at the end.
- Output JSON satisfies coverage: every line in `[1..totalLines]` is in exactly one segment.
- Running twice on the same transcript produces byte-identical output (fake LLM is deterministic; stitching is deterministic).
- Substring lookup (`segment 2025-8-28`) resolves to the right file.

#### 4. .gitignore — do NOT add `state/segments/`

State is checked in by design (per ticket 005 — `state/processed.json` is committed). The segment outputs follow the same convention: committing them lets future runs see what was previously segmented without re-spending tokens. Confirm `.gitignore` does not exclude `state/segments/`.

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/segment.test.ts` passes
- [x] All tests pass: `bun test`
- [x] Type check passes: `bun run typecheck`
- [x] `bun run segment --help`-like usage path prints usage and exits non-zero when no arg given
- [x] Running `bun run segment <name>` twice produces byte-identical `state/segments/<name>.json`
- [x] Stitched output covers every line 1..totalLines with no gaps and no overlaps (asserted in CLI test)

#### Manual Verification
- [x] `bun run segment 000.through-a-song-darkly.2025-8-28` writes a segments file where lines ~1–~580 are labeled `ooc` and a `recap` segment appears starting near line ~600 (matches the eyeball check from the ticket)
- [x] Hand-review segments on one additional transcript (e.g. `103.a-hunt-of-metal-and-vine.2025-6-9`) — IC/OOC boundaries look approximately right
- [x] `bun run cost-report` shows the segment stage cost per transcript at or under ~$0.10
- [x] `low` confidence segments cluster around transitions (sanity check, hand-inspected)
- [x] `bun run transcripts list` now shows the `seg` column populated for processed transcripts
- [x] After `bun run transcripts reset <name> --stage segmented`, a re-run regenerates the file and re-marks the stage

**Implementation Note**: After phase 3, run on one transcript first, eyeball the output, and only then run `--all`.

---

## Testing Strategy

### Unit Tests

- **Chunker**: window math (sizes, overlap, last-window truncation, single-window edge case, invalid options).
- **Segmenter core**: `normalizeWindow` (gap snap-fill, edge nudge, bound clamping); `stitchSegments` (high-beats-low, center-wins tie-break, same-label merge, summary-split, coverage validation).
- **CLI**: single-file path, `--all` skipping, error recording, deterministic output, substring lookup.

### Integration Tests

- The CLI test above is the integration test — it exercises chunker → segmenter → stitching → ledger + JSON persistence end-to-end against an injected fake `complete()`.

### Manual Testing Steps

1. `bun run segment 000.through-a-song-darkly.2025-8-28` — check the segments JSON makes intuitive sense (OOC at start, recap around line 600, IC for the bulk).
2. Open `state/segments/000.through-a-song-darkly.2025-8-28.txt.json` and scan the segment summaries — they should track the transcript's narrative.
3. `bun run cost-report` — confirm the segment stage is well under budget.
4. `bun run segment --all` — let it run; expect ~37 × ~$0.05 ≈ $2 total.
5. `bun run transcripts list` — every transcript should now have a `✓` under `seg`.
6. Pick one transcript, `bun run transcripts reset <name> --stage segmented`, then `bun run segment <name>` again — confirm the segments file is recreated and the stage is re-marked.

## Performance Considerations

- ~11 windows × 37 transcripts = ~407 LLM calls. Sequential is fine; parallelism is unnecessary and would complicate rate-limit handling. Wall-clock estimate: ~407 × ~3s = ~20 minutes for `--all` if we sequence everything.
- Caching pays off after the first window per transcript: ~80% of windows benefit from `cache_read` pricing on the cached system prompt (~$0.10/M vs $1.00/M for fresh input).
- Each window is ~400 lines × ~80 chars ≈ 32 KB ≈ ~8K tokens. Cached system + rubric ≈ ~500 tokens. Output ≈ ~500–1000 tokens. Per-window cost (cached): roughly `8000 * $1/M + 500 * $0.10/M + 1000 * $5/M ≈ $0.013`. ~11 windows × $0.013 ≈ $0.14 — slightly over the ticket's $0.10 target. If real costs land high, the first lever is to reduce `windowLines` overlap (40 → 20) or shrink window size; the second is to drop `oneLineSummary` from the schema (the bulk of the output tokens). Surface this on the first real-transcript run before committing to `--all`.

## Migration Notes

None. This adds a new stage; no existing data needs to move.

## References

- Original ticket: `tickets/006-transcript-segmentation.md`
- Parent epic: `tickets/001-create-project.md`
- Previous plan (discovery + ledger): `thoughts/shared/plans/2026-05-17-005-transcript-discovery-ledger.md`
- LLM wrapper: `src/llm.ts:33`
- Cached-prompt + structured-output precedent: `src/wiki/summarize.ts:51`
- CLI pattern to mirror: `src/cli/transcripts.ts:16`, `src/cli/index-wiki.ts:7`
- Ledger mutators used: `src/transcript/ledger.ts:157` (`markStage`), `src/transcript/ledger.ts:165` (`recordError`)
- Pricing table: `src/pricing.ts:10`
