# Naming Resolution Implementation Plan

## Overview

Machine-generated transcripts contain name variants that corrupt the pipeline: transcription errors ("Roundhack" instead of "Roundhat"), punctuation drift ("Gin-Soaked Rag" vs "Gin Soaked Rag"), and genuine short-form aliases not yet in wiki frontmatter. These cause false contradictions at match time (the classifier sees "Roundhack" ≠ "Roundhat" and emits `contradict`) and miss candidate pages entirely when the entity string doesn't land in the fast-match map.

This plan adds a `resolve` stage between `extract` and `match` that canonicalizes entity names against the wiki index, rewrites them in claim text and the entities array, and records alias suggestions for the proposer to surface.

## Current State Analysis

- **Fast-match in `src/reconcile/candidates.ts:58-65`**: exact lowercase comparison of `claim.entities` strings against wiki `title` and `aliases` fields. No normalization, no fuzzy.
- **Concrete failures observed in `state/claims/000.through-a-song-darkly.2025-8-28.txt.json`**:
  - `"Roundhack"` (entity) — transcription error for "Roundhat Gang". The classifier matches the claim via the `Tywelwyn Leatherhide` entity but then marks it `contradict` because the page says "Roundhat" and the claim says "Roundhack". False contradiction.
  - `"Gin-Soaked Rag"` (entity) — the wiki title is "Gin Soaked Rag" (no hyphen). The hyphen prevents exact match; only the `"Ginny"` alias rescues this particular claim. Future claims using the full hyphenated form and no Ginny reference would fall to LLM fallback.
  - `"Coppajaw"` / `"Cobblejaw"` / `"Copperjaw"` — three variant spellings for what is probably the same NPC across sessions. No wiki page exists yet; all correctly fall through as `new`. Resolving them to a shared canonical string before they reach the proposer means the proposer creates one page instead of three.
- **Ledger stages**: `STAGE_ORDER` in `src/transcript/ledger.ts:5-12` is `segmented → extracted → matched → proposed → verified → prOpened`. `resolved` is missing.
- **Single transcript has been fully matched** (`000.through-a-song-darkly.2025-8-28.txt`); all others are only segmented or not yet started. Resetting the single matched transcript to re-run through the new stage is low cost.

## Desired End State

After this plan:
- `bun run resolve <name>` / `bun run resolve --all` canonicalizes entities for extracted transcripts.
- `state/resolutions/<filename>.json` holds claim objects with rewritten text and entities, plus an `aliasSuggestions` list.
- `bun run match` reads from `state/resolutions/` and requires `stages.resolved !== null`.
- The false-contradiction for "Roundhack" → "Roundhat Gang" disappears: the claim text and entity are rewritten before match.
- Format variants that survive normalization fall through correctly as `new` entities (no false merges).

**Verify by**: running `bun run resolve 2025-8-28` followed by `bun run match 2025-8-28` and checking that (a) no claim in `state/matches/` has `relation: 'contradict'` whose rationale mentions a spelling mismatch, and (b) `state/resolutions/...json` `aliasSuggestions` lists "Roundhack" → Roundhat Gang.

## What We're NOT Doing

- Touching `state/claims/` — the existing claims files are read-only inputs to resolve.
- Adding `resolved` as a ledger stage that can be skipped — match will require it.
- Auto-adding aliases to wiki frontmatter — the resolve stage only _suggests_ them; the proposer (ticket 009) generates the actual alias-addition wiki edits.
- Correcting claim text that doesn't contain the variant verbatim (e.g. paraphrase forms).
- Fuzzy-matching very short strings (< 4 chars) to avoid spurious matches.
- Doing any resolution during extraction — the extractor stays faithful to the transcript source.

---

## Phase 1: Ledger and Type Changes

### Overview

Add `resolved` to the ledger stage order, extend the `Claim` type with an optional `entityResolutions` field, and update `match` CLI to require the new stage.

### Changes Required

#### 1. Add `resolved` to ledger
**File**: `src/transcript/ledger.ts`

Add `'resolved'` between `'extracted'` and `'matched'` in `STAGE_ORDER` (line 5):
```ts
export const STAGE_ORDER = [
  'segmented',
  'extracted',
  'resolved',   // new
  'matched',
  'proposed',
  'verified',
  'prOpened',
] as const;
```

Update `StagesSchema` and `EMPTY_STAGES` — add `resolved: z.string().nullable()` and `resolved: null`. Use `.optional().default(null)` in the schema so existing persisted ledger entries that lack the key still parse:
```ts
export const StagesSchema = z.object({
  segmented: z.string().nullable(),
  extracted: z.string().nullable(),
  resolved:  z.string().nullable().optional().transform(v => v ?? null),
  matched:   z.string().nullable(),
  proposed:  z.string().nullable(),
  verified:  z.string().nullable(),
  prOpened:  z.string().nullable(),
});

export const EMPTY_STAGES: Stages = {
  segmented: null, extracted: null, resolved: null, matched: null,
  proposed:  null, verified:  null, prOpened: null,
};
```

#### 2. Extend `Claim` type
**File**: `src/transcript/extract.ts`

Add `EntityResolution` interface and optional field on `Claim`:

```ts
export interface EntityResolution {
  original:     string;          // as it appeared in the transcript
  canonical:    string;          // wiki title, or original if no match
  page:         string | null;   // wiki page path, or null
  method:       'exact' | 'fuzzy' | 'llm' | 'none';
  suggestAlias: boolean;         // true when fuzzy/LLM found a match not in wiki aliases
}

export interface Claim extends RawClaim {
  sourceSegmentStartLine: number;
  entityResolutions?: EntityResolution[];   // populated by resolve stage; absent before
}
```

`entityResolutions` is optional so existing claims files (pre-resolve) still type-check.

#### 3. Update match CLI to require `resolved`
**File**: `src/cli/match.ts`

Change the `--all` filter (line 61-65):
```ts
const targets = ledger.entries.filter(
  (e) =>
    presentFilenames.has(e.filename) &&
    e.stages.resolved !== null &&    // was: e.stages.extracted !== null
    e.stages.matched === null,
);
```

Change the single-target guard (after line 104):
```ts
if (r.entry.stages.resolved === null) {
  console.error(`'${r.entry.filename}' has not been resolved — run 'bun run resolve ${name}' first`);
  process.exit(1);
}
```

Change the claims source constant from `CLAIMS_DIR = 'state/claims'` to read from `RESOLUTIONS_DIR = 'state/resolutions'` and update `matchOne` to load `state/resolutions/<filename>.json` instead of `state/claims/<filename>.json`.

The file shape is the same except the root key is `claims` in both; add a new `ResolutionsFile` interface that adds `aliasSuggestions` to the existing shape (match ignores that field).

### Success Criteria

#### Automated Verification
- [x] `bun test src/transcript/ledger.test.ts` — all existing tests pass
- [x] Existing ledger JSON with no `resolved` field parses without error (add a regression test)
- [x] `bun run typecheck` passes

---

## Phase 2: Build `src/reconcile/resolve.ts`

### Overview

The core resolution module. Three lookup tiers per entity: normalized-exact, token-fuzzy, and LLM confirmation for borderline fuzzy hits. Rewrites claim text and entities array in-place before returning.

### Changes Required

#### 1. Lookup helpers

```ts
function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number { /* standard DP */ }

// Returns best (distance, fraction) between any token pair from entity and title.
// fraction = distance / max(len(et), len(tt)).
// Skips tokens shorter than MIN_TOKEN_LEN (4) to avoid spurious matches.
function bestTokenPairDistance(entityNorm: string, titleNorm: string): number {
  const MIN = 4;
  const eToks = entityNorm.split(' ').filter(t => t.length >= MIN);
  const tToks = titleNorm.split(' ').filter(t => t.length >= MIN);
  if (eToks.length === 0 || tToks.length === 0) return Infinity;
  let best = Infinity;
  for (const et of eToks) {
    for (const tt of tToks) {
      const d = levenshtein(et, tt) / Math.max(et.length, tt.length);
      if (d < best) best = d;
    }
  }
  return best;
}
```

Fuzzy threshold: `FUZZY_RATIO_THRESHOLD = 0.25` — covers 2-edit errors on 8-char tokens ("Roundhack"→"Roundhat" = 2/9 ≈ 0.22).

#### 2. `buildEntityLookup(index: WikiIndex)`

Returns:
```ts
interface EntityLookup {
  exactMap: Map<string, { title: string; path: string }>;
  fuzzyEntries: Array<{ titleNorm: string; title: string; path: string }>;
}
```

`exactMap` key = `normalizeStr(title)` and one entry per alias `normalizeStr(alias)`. `fuzzyEntries` = one entry per page (Rules/* excluded).

#### 3. LLM confirmation prompt

System (cached per run = wiki index summary from `buildIndexSummary`):
```
You are a name-resolution assistant for a Pathfinder 2e campaign wiki.
For each item below, decide if the transcribed name is a variant of the candidate wiki entity.
Answer only when confident; for uncertain cases emit confirmed: false.
Be conservative — if in doubt, say false.

{{INDEX_SUMMARY}}
```

User (per batch):
```
[0] transcribed: "Roundhack" | candidate: "Roundhat Gang" (Org/Roundhat Gang/index.md) | context claim: "The Roundhack gang is run by Tywelwyn Leatherhide."
[1] transcribed: "Anok" | candidate: "Anouk Marchal" (Org/Iconoclasm/People/Anouk Marchal.md) | context claim: "Anok and Anaïs are twins."
```

Output schema:
```ts
z.object({
  confirmations: z.array(z.object({
    index:     z.number().int().nonnegative(),
    confirmed: z.boolean(),
  })),
})
```

Only items where `confirmed: true` are canonicalized; others become `method: 'none'`.

#### 4. `resolveTranscript` orchestrator

```ts
export interface AliasSuggestion {
  variant:     string;   // e.g. "Roundhack"
  canonical:   string;   // e.g. "Roundhat Gang"
  page:        string;   // wiki path
  method:      'fuzzy' | 'llm';
  occurrences: number;
}

export interface ResolveTranscriptResult {
  claims:           ResolvedClaim[];   // Claim[] with entityResolutions and rewritten text/entities
  aliasSuggestions: AliasSuggestion[];
  resolvedCount:    number;  // entities resolved via fuzzy/LLM (not counting exact)
  suggestionCount:  number;  // unique alias suggestions
}
```

Algorithm per transcript:
1. Build `lookup` once.
2. For each claim × each entity string:
   - Tier 1: `exactMap.get(normalizeStr(entity))` → `method: 'exact'`, `suggestAlias: false`.
   - Tier 2: best fuzzy match via `bestTokenPairDistance` ≤ `FUZZY_RATIO_THRESHOLD` → store as fuzzy candidate, pending LLM confirmation.
   - Tier 3: batch all fuzzy candidates into a single Haiku LLM call; keep only `confirmed: true`.
   - Unconfirmed or no fuzzy candidate → `method: 'none'`, `canonical: original`, `page: null`.
3. For each confirmed resolution (method fuzzy or llm):
   - Rewrite `claim.entities` entry to `canonical`.
   - If `original` (normalized) is not already in the wiki's alias list for that page, set `suggestAlias: true`.
   - Rewrite `claim.claim` text: `claim.claim.replace(new RegExp(escapeRegex(original), 'gi'), canonical)`.
4. Collect all `suggestAlias: true` resolutions into `aliasSuggestions`, deduped by `(variant, page)`, counting occurrences.

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/resolve.test.ts` — all new tests pass (see Phase 4)
- [x] `bun run typecheck` passes

---

## Phase 3: Build `src/cli/resolve.ts` and Wire Up

### Overview

CLI command following the exact pattern of `src/cli/extract.ts` and `src/cli/match.ts`.

### Changes Required

#### 1. New CLI module
**File**: `src/cli/resolve.ts` (new)

Constants:
```ts
const TRANSCRIPTS_DIR  = 'transcripts';
const LEDGER_PATH      = 'state/processed.json';
const CLAIMS_DIR       = 'state/claims';
const RESOLUTIONS_DIR  = 'state/resolutions';
const WIKI_INDEX_PATH  = 'state/wiki-index.json';
```

`--all` filter: `e.stages.extracted !== null && e.stages.resolved === null`.

Single-target guards: require `extracted` stage set; refuse if no claims file on disk.

`resolveOne` reads `state/claims/<filename>.json`, calls `resolveTranscript`, writes `state/resolutions/<filename>.json`, marks `resolved` in ledger.

Output file shape:
```ts
{
  filename:          string;
  contentHash:       string;
  claimsContentHash: string;  // contentHash from the source claims file
  resolvedCount:     number;
  suggestionCount:   number;
  aliasSuggestions:  AliasSuggestion[];
  claims:            ResolvedClaim[];
}
```

CLI log line:
```
resolved foo.txt: 96 claims, 8 entities resolved (3 exact, 5 via LLM), 3 alias suggestions
```

#### 2. Register in CLI dispatcher
**File**: `src/cli/index.ts`

```ts
import { resolve } from './resolve';
// ...
export const handlers: Record<string, CliHandler> = {
  // existing...
  'resolve': resolve,
};
```

#### 3. Add script to package.json
```json
"resolve": "bun index.ts resolve"
```

#### 4. Add `MODEL_RESOLVE` to config
**File**: `src/config.ts`

```ts
MODEL_RESOLVE: 'claude-haiku-4-5-20251001'
```

Default Haiku — the task is a simple yes/no confirmation with rich context, not complex reasoning.

### Success Criteria

#### Automated Verification
- [x] `bun test src/cli/resolve.test.ts` — tests for --all and single-target paths
- [x] `bun run typecheck` passes

---

## Phase 4: Tests

### New test file: `src/reconcile/resolve.test.ts`

```
normalizeStr
  ✓ lowercases and collapses hyphens to spaces
  ✓ collapses em-dashes and multiple spaces

levenshtein (internal)
  ✓ identical strings → 0
  ✓ single insertion → 1
  ✓ "roundhack" vs "roundhat" → 2

bestTokenPairDistance
  ✓ "Roundhack" vs "Roundhat Gang" → ratio ≈ 0.22 (≤ threshold)
  ✓ "Anok" vs "Anouk Marchal" → ratio 0.20 (≤ threshold)
  ✓ single-char tokens skipped, no spurious match
  ✓ unrelated strings → ratio > 0.25

buildEntityLookup
  ✓ alias "Ginny" resolves to Gin Soaked Rag page
  ✓ "Gin-Soaked Rag" (normalized) resolves via title normalization
  ✓ Rules/* pages excluded

resolveTranscript (with mock completeFn)
  ✓ exact match: "Ginny" → canonical "Gin Soaked Rag", method 'exact', suggestAlias false
  ✓ format variant: "Gin-Soaked Rag" → "Gin Soaked Rag", method 'exact', suggestAlias false
  ✓ fuzzy+LLM: "Roundhack" (LLM confirms) → "Roundhat Gang", method 'llm', suggestAlias true
  ✓ fuzzy+LLM rejected: LLM confirms false → method 'none', original preserved
  ✓ unknown entity "Copperjaw" (no fuzzy candidate) → method 'none', page null
  ✓ claim text rewrite: "Roundhack gang is run by" → "Roundhat Gang is run by"
  ✓ entities array updated with canonical
  ✓ aliasSuggestions deduped and counts occurrences correctly
  ✓ LLM call batches all fuzzy candidates in one request
```

### New test file: `src/cli/resolve.test.ts`

Mirror the pattern in `src/cli/extract.test.ts` / `src/cli/match.test.ts`:
- Resolve a transcript that hasn't been extracted → error
- Resolve a transcript already resolved → no-op / skip in --all
- Resolve single transcript → writes resolutions file, marks ledger

### Success Criteria

#### Automated Verification
- [x] `bun test src/reconcile/resolve.test.ts` — all tests pass
- [x] `bun test src/cli/resolve.test.ts` — all tests pass
- [x] `bun test` — full suite green

---

## Phase 5: End-to-End Validation

### Overview

Reset the single matched transcript, run the full new pipeline, verify the false-contradiction is gone.

### Changes Required

#### 1. Reset matched transcript
```
bun run transcripts reset 2025-8-28 --stage matched
```

This clears `matched` and downstream (already nothing downstream). Leaves `resolved` as null on the entry (new field).

#### 2. Run resolve + match
```
bun run resolve 2025-8-28
bun run match   2025-8-28
```

### Success Criteria

#### Automated Verification
- [x] `state/resolutions/000.through-a-song-darkly.2025-8-28.txt.json` exists
- [x] `aliasSuggestions` in resolutions file includes `"Roundhack"` → Roundhat Gang
- [x] `state/matches/000.through-a-song-darkly.2025-8-28.txt.json` exists
- [x] `bun test` — full suite passes

#### Manual Verification
- [x] Open `state/matches/...json` — no claim has `relation: 'contradict'` where the rationale is a spelling-mismatch rather than a genuine world-fact conflict
- [x] Open `state/resolutions/...json` — spot-check 10 `entityResolutions` entries: exact matches are correct; LLM-confirmed entries look right in context
- [x] Verify the "Roundhack" claim text was rewritten to "Roundhat Gang" in the resolutions file
- [x] Confirm `aliasSuggestions` does not contain obviously-wrong merges (e.g. unrelated names merged by coincidence)

---

## Testing Strategy

### Unit
- `resolve.test.ts`: pure logic, no real LLM calls, mock `completeFn` returning canned confirmations
- `ledger.test.ts`: add one regression test verifying old entries without `resolved` key parse correctly

### Integration
- Phase 5 is the integration test

### Regression
- `bun test` must pass after each phase

---

## Performance Considerations

LLM cost for resolve: ~$0.003/transcript (single Haiku batch call, index summary cached). For 37 transcripts: ~$0.11 total. Negligible.

The resolve stage slightly improves match cost by replacing fuzzy-miss entities with canonical strings that hit the fast-map, reducing the number of claims that fall through to the LLM-fallback batch in `findCandidates`.

---

## References

- Original ticket: `tickets/015-naming-resolution.md`
- Candidates fast-map: `src/reconcile/candidates.ts:58-65`
- Classifier false-contradiction evidence: `state/matches/_debug/000.through-a-song-darkly.2025-8-28.txt/Org_Roundhat_Gang_People_Tywelwyn_Leatherhide.json`
- Claim type: `src/transcript/extract.ts:117`
- Ledger stage order: `src/transcript/ledger.ts:5`
- Config defaults: `src/config.ts`
- Prior plan (014): `thoughts/shared/plans/2026-05-18-014-stakeholder-requests.md`
