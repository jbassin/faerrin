# Transcript Typo-Surfacer CLI Implementation Plan

## Overview

Add a CLI to `@faerrin/content` that **automatically surfaces likely transcription
errors** in session transcripts so the user can update `scripts/defs.yaml` quickly,
replacing the all-manual "read every line in `bun run review`" workflow.

The tool is a **hybrid pipeline with three detection modes** sharing ~90% of their
machinery (tokenizer, NFKD normalizer, OOV gate, phonetic + edit-distance metrics):

1. **Known-entity correction** — match out-of-vocabulary (OOV) tokens against the
   canonical lexicon (`defs.yaml` keys + wiki page names), producing ranked
   correction candidates. Catches `"12 wins"` → `Tywelwyn`.
2. **New-entity discovery** — cluster the OOV set against *itself* and rank clusters
   by cross-session recurrence, catching cases like `"Eyestel"`/`"Istel"` where
   **neither** form is in the lexicon yet.
3. **LLM judge** (Phase 2) — a second-stage Claude pass that judges the heuristic
   candidates (confirm / new / reject), with deterministic guardrails and write-back
   to `defs.yaml`. An optional `full` mode runs the LLM over whole chunks as a
   periodic recall audit.

Built in **two phases**: Phase 1 is heuristics-only (modes 1 + 2, no API cost, ships
first); Phase 2 adds the LLM judge + write-back.

## Current State Analysis

- **Corrections are reactive.** `scripts/defs.yaml` (197 canonical keys) maps a
  *correct form* → list of *mistranscriptions* authored as **regex fragments**.
  `loadCorrections()` (`scripts/lib/corrections.ts:13`) compiles them into one
  case-insensitive, `\b`-bounded alternation applied during `ingest`
  (`scripts/pipeline/ingest.ts:93,103`). A garble is only fixed *after* the user
  has eyeballed it and hand-added the pair.
- **Detection is 100% manual.** `bun run review` (`scripts/review.ts`) serves a web
  UI on port 10116 that renders `scripts/data/*.json` line by line; the user selects
  text → modal → `POST /api/correction` → `addCorrection()` (`scripts/review.ts:28`)
  appends to `defs.yaml` via `yaml.dump(..., { lineWidth: -1 })`.
- **A canonical lexicon already exists, for free.** Two sources:
  - the 197 `defs.yaml` keys, and
  - `walkContent()` (`scripts/lib/content.ts:15`) already parses every wiki doc and
    derives `names` (filename + folder-index name + `title` + `aliases`), **already
    excluding `Script/`** (`content.ts:18`). `buildLinker()`
    (`scripts/lib/linker.ts:21`) shows the exact name-index pattern to reuse.
  - Scale: 197 defs keys + 121 wiki articles (33 with aliases) ≈ 300+ canonical
    proper nouns.
- **Data shape** (`scripts/lib/types.ts`): `Transcript = { date, audio, script: FormattedLine[] }`;
  `FormattedLine = { start, second, text, user: { name, color }, duration }`.
  75 session files in `scripts/data/`, hundreds–1000+ lines each.
- **The vocabulary is invented proper nouns** (Færrin, Tywelwyn, barghest, Sbrtlby,
  Ki-Rin, Anaïs) — exactly the OOV tokens whisperx mangles, and exactly what generic
  spellcheck cannot resolve.
- **LLM access pattern.** `@faerrin/llm`'s `AnthropicClient`
  (`pkg/llm/src/client.ts`) is the only place the Anthropic SDK is called. Structured
  output is done via a **forced tool-call** (`tool` + `tool_choice`, `client.ts:108`),
  *not* `output_config.format`. heartwood wraps it in `complete()`
  (`pkg/heartwood/src/llm.ts:37`) — Zod schema → `zod-to-json-schema` → forced tool →
  parse + cost log. We mirror this pattern (content does not depend on heartwood).
- **Pricing** (`pkg/llm/src/pricing.ts`) already has rows for
  `claude-haiku-4-5-20251001` ($1/$5) and `claude-sonnet-4-6` ($3/$15). **No Opus 4.8
  row.**
- **No tests in content yet**; heartwood/llm/wretch use `bun:test`, co-located
  (`foo.ts` ↔ `foo.test.ts`), with inline factories and dependency injection (pass a
  stub `LlmClient`, no module mocking).

### Key Discoveries

- **`temperature: 0` is sent unconditionally** by both the shared client
  (`pkg/llm/src/client.ts:106`) and heartwood's `complete()`
  (`pkg/heartwood/src/llm.ts:56`). Haiku 4.5 and Sonnet 4.6 accept it; **Opus 4.8 / 4.7
  reject `temperature` with a 400** (verified against the `claude-api` skill). heartwood
  never trips this because it only uses Haiku/Sonnet. **Decision: escalate ambiguous
  candidates to Sonnet 4.6, not Opus 4.8** — it accepts `temperature`, supports
  structured outputs, already has a pricing row, is far cheaper than Opus, and keeps us
  consistent with heartwood. Opus 4.8 stays a documented future option *only if* the
  shared client is extended to omit `temperature` for Opus-tier models.
- **Prompt-cache minimum is 4096 tokens on both Haiku 4.5 and Sonnet 4.6's tier**
  (Sonnet 4.6 is actually 2048; Haiku 4.5 is 4096) — the client's own doc-comment
  already warns about this (`client.ts:96`). The cached lexicon block must clear the
  relevant minimum or caching silently no-ops; verify via `usage.cacheReadTokens`.
- **`defs.yaml` values are regex fragments, and we keep that format** (decision).
  `corrections.ts:23` wraps each value in `\b...\b` (no escaping). The regex power is
  actively load-bearing — `Pyrelight: [pyro\s*light]`, `Tywelwyn: ['12\s*wins?']`,
  `starward: [star\s*w[ao]rd]`, `Aurideon: [Iridiu[mn]]` — one fragment collapses a whole
  cloud of ASR spacing/vowel variants that a literal-only format could not. Implications
  for write-back, both cheap:
  - **Auto-added *literal* spans must be regex-escaped** (a mis-heard `"P. O. Box"` →
    `P\. O\. Box`) so a literal `.` doesn't over-match. **`escapeRegex()` already exists**
    at `scripts/lib/linker.ts:4` — reuse it.
  - **Optional enhancement (leans into the format):** when adding a multi-word variant,
    emit `\s*` between tokens (e.g. `pyro\s*light`) instead of a literal space, so one
    auto-added entry generalizes across spacing variants — strictly better coverage.
  - On the **read** side we never parse the regex values structurally; we just run the
    compiled `loadCorrections` matcher to skip already-covered tokens, which works
    natively against regex entries.
- **`defs.yaml` does not require a wiki page to exist.** It is purely
  `correct-form → [variants]`, so the user can canonicalize a newly-discovered entity
  (Mode 2) *before* writing its wiki article.
- **`an-array-of-english-words`, `mnemonist`, `double-metaphone`, etc. are pure-ESM /
  zero-dep / TS-typed** — clean under Bun.

## Desired End State

A new `bun run surface` CLI in `@faerrin/content` with subcommands:

- `surface known <date|all>` — Mode 1; print ranked correction candidates per session.
- `surface discover [--min-count N]` — Mode 2; print recurring OOV clusters across all
  sessions, newest/most-frequent first.
- `surface judge <date|all> [--mode hybrid|full] [--write]` — Phase 2; run the LLM judge
  over candidates and (with `--write`) append confirmed pairs to `defs.yaml`.

Verification: the workspace stays green (`bun --filter '*' typecheck` and
`bun --filter '*' test`); Phase 1 runs with zero API calls and produces a useful ranked
list on real sessions; Phase 2 confirms/auto-appends corrections that then survive a
re-run of `bun run --filter @faerrin/content pipeline` (the garble is corrected at
ingest and no longer re-flagged).

## What We're NOT Doing

- **Not modifying the ingest/export/script pipeline or `loadCorrections()`** — the
  surfacer is a separate, read-mostly tool. The only write target is `defs.yaml`.
- **Not changing `outDir`/`publicDir`/`base`** or anything aether builds (no overlap).
- **Not building a web UI in Phase 1.** Output is CLI text/JSON. Wiring candidates into
  the existing `review.ts` UI is a possible later enhancement, explicitly out of scope
  here.
- **Not using Opus 4.8** for the judge (see temperature decision above).
- **Not building an embedding/retrieval layer** for the lexicon — it's ~300 names, small
  enough to inline and prompt-cache.
- **Not auto-resolving single-occurrence new entities.** Mode 2 needs recurrence; a true
  one-off is left to the `full` audit or human review (documented limitation).
- **Not auto-creating wiki pages.** Write-back targets `defs.yaml` only.

## Implementation Approach

Phase 1 builds reusable, pure, unit-testable primitives in `scripts/lib/` and the two
heuristic modes + CLI in `scripts/surface/`, with a `scripts/surface.ts` entrypoint that
mirrors the existing `scripts/run.ts` / `scripts/review.ts` shape. Phase 2 adds a
content-local `complete()`-style LLM helper (mirroring heartwood, not importing it), the
judge stage, and `defs.yaml` write-back (sharing one extracted `addCorrection`).

---

## Phase 1: Heuristic surfacer (modes 1 + 2, no LLM)

### Overview
Ship a zero-cost, deterministic candidate surfacer. Build the shared primitives first
(each independently tested), then the two modes, then the CLI.

### Changes Required

#### 1. Dependencies
**File**: `pkg/content/package.json`
**Changes**: add runtime deps and a script.

```jsonc
"dependencies": {
  "gray-matter": "^4.0.3",
  "js-yaml": "^4.1.0",
  "mnemonist": "^0.40.0",          // SymSpell + BKTree
  "double-metaphone": "^2.0.1",
  "damerau-levenshtein": "^1.0.8", // OSA distance w/ transpositions
  "jaro-winkler": "^0.2.8",
  "dice-coefficient": "^2.1.1",
  "an-array-of-english-words": "^2.0.0"
  // optional later: "nspell", "dictionary-en"
},
"scripts": {
  // ...existing...
  "surface": "bunx tsx scripts/surface.ts"
}
```

#### 2. Token normalization
**File**: `pkg/content/scripts/lib/normalize.ts` (new)
**Changes**: NFKD-fold + strip combining marks + lowercase for *matching only*;
tokenize a line into word tokens and n-grams (up to 3), each carrying its verbatim
original span. Strip surrounding punctuation but keep apostrophes/hyphens inside tokens.

```ts
/** Fold diacritics for matching; the canonical/original text keeps its glyphs. */
export function foldForMatch(s: string): string {
  return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}
export interface Tok { span: string; fold: string; start: number /* char offset */ }
export function tokenize(text: string): Tok[]               // unigrams
export function ngrams(toks: Tok[], maxN = 3): Tok[]        // 1..3-grams w/ joined span
```

#### 3. Phonetic / edit-distance ensemble
**File**: `pkg/content/scripts/lib/phonetics.ts` (new)
**Changes**: wrap the libs and expose a single ensemble similarity in [0,1].

```ts
import { doubleMetaphone } from "double-metaphone"
import jaroWinkler from "jaro-winkler"
import damerau from "damerau-levenshtein"
import { diceCoefficient } from "dice-coefficient"

export function phoneticCodes(fold: string): [string, string] // [primary, secondary]
/** edit distance between phonetic codes, normalized — robust to fantasy spelling */
export function phoneticSim(aFold: string, bFold: string): number
/** weighted blend: damerau (OSA) + jaro-winkler + phonetic-code distance + dice */
export function ensembleSim(aFold: string, bFold: string): number
```

#### 4. English OOV gate
**File**: `pkg/content/scripts/lib/english.ts` (new)
**Changes**: a `Set`-membership gate over `an-array-of-english-words` (~275k).
`isOov(fold)` = not English **and** not a contraction/number. (nspell upgrade deferred.)

#### 5. Canonical lexicon
**File**: `pkg/content/scripts/lib/lexicon.ts` (new)
**Changes**: build the lexicon from `defs.yaml` keys + `walkContent()` names
(Script already excluded). Precompute folded forms + phonetic codes; expose membership
and nearest-match. Reuses `loadCorrections`'s YAML read and `walkContent`.

```ts
export interface LexEntry { canonical: string; fold: string; codes: [string,string] }
export interface Lexicon {
  has(fold: string): boolean
  /** top-k canonical hypotheses for an OOV fold, by ensembleSim, above `floor`. */
  nearest(fold: string, k?: number, floor?: number): { canonical: string; score: number }[]
  entries: LexEntry[]
}
export async function buildLexicon(): Promise<Lexicon> // defs keys ∪ wiki names
```

#### 6. Session token stream
**File**: `pkg/content/scripts/surface/tokens.ts` (new)
**Changes**: read a `scripts/data/<date>.json` (reuse `dataDir` from `paths.ts`),
assign each line a stable global 0-based `lineRef`, emit candidate tokens/n-grams with
`{ lineRef, span, fold, speaker, lineText }`. Skip tokens already covered by the compiled
`defs.yaml` regex (reuse `loadCorrections`-style compile) and obvious non-words.

#### 7. Mode 1 — known-entity correction
**File**: `pkg/content/scripts/surface/known.ts` (new)
**Changes**: for each OOV token in a session, `lexicon.nearest(fold, 5)`; emit a
`KnownCandidate { lineRef, span, speaker, lineText, hypotheses: {canonical,score}[] }`
when the top score clears a loose recall-biased threshold. Dedupe by `(lineRef, span)`.

#### 8. Mode 2 — new-entity discovery
**File**: `pkg/content/scripts/surface/discover.ts` (new)
**Changes**: across **all** `scripts/data/*.json`, collect OOV tokens that are *not*
near any lexicon entry; index them in a `mnemonist` BK-tree and cluster by mutual
ensemble similarity; aggregate occurrences across sessions. Emit
`DiscoveryCluster { variants: string[]; count: number; sessions: string[]; examples: {date,lineRef,lineText}[] }`,
ranked by `count`. Filter clusters below `--min-count` (default 3) — the recurrence
signal that separates real new entities from one-off mis-hearings.

#### 9. Report + CLI entrypoint
**Files**: `pkg/content/scripts/surface/report.ts` (new),
`pkg/content/scripts/surface.ts` (new — mirrors `run.ts`/`review.ts`)
**Changes**: `report.ts` renders a CLI table (and `--json`). `surface.ts` parses
`known|discover|judge` + flags and dispatches (lazy-import each mode like `run.ts:6`).
Phase 1 wires `known` and `discover`; `judge` prints "Phase 2" until implemented.

#### 10. Tests (co-located, `bun:test`)
**Files**: `normalize.test.ts`, `phonetics.test.ts`, `lexicon.test.ts`,
`known.test.ts`, `discover.test.ts`
**Changes**: unit-test the primitives with inline factories. Anchor cases on real data:
`ensembleSim` ranks `"twelwyn"`→`Tywelwyn` and `"12 wins"`→`Tywelwyn` highly;
`foldForMatch("Færrin")`/`("Anaïs")` produce stable ASCII; `isOov` rejects "the"/"giant"
but accepts "sbrtlby"; Mode 2 clusters `["eyestel","istel","eye stel"]` and respects
`--min-count`.

### Success Criteria

#### Automated Verification
- [ ] Deps install: `bun install`
- [ ] Type checking passes: `bun run --filter @faerrin/content typecheck`
- [ ] Tests pass: `bun run --filter @faerrin/content test`
- [ ] Whole workspace green: `bun --filter '*' typecheck && bun --filter '*' test`
- [ ] `bun run --filter @faerrin/content surface known 2026-5-21` exits 0 and prints candidates
- [ ] `bun run --filter @faerrin/content surface discover --min-count 3` exits 0 and prints clusters

#### Manual Verification
- [ ] Mode 1 surfaces real mistranscriptions on a few sessions, with plausible top hypotheses
- [ ] Mode 1 false-positive rate is tolerable (rare English words not over-flagged)
- [ ] Mode 2 surfaces at least one genuine recurring unknown entity across the 75 sessions
- [ ] Diacritic names (Færrin, Anaïs) are matched, not mangled

**Implementation Note**: After Phase 1 automated checks pass, pause for the user to
eyeball Mode 1/Mode 2 output quality on real sessions and tune thresholds before
building Phase 2.

---

## Phase 2: LLM judge + write-back

### Overview
Add a Claude judge that classifies heuristic candidates (confirm/new/reject) and,
on confirm, appends the pair to `defs.yaml`. Haiku 4.5 default, escalate ambiguous to
Sonnet 4.6. Backlog runs route through the Batches API.

### Changes Required

#### 1. Dependencies + workspace dep + env
**Files**: `pkg/content/package.json`, `pkg/content/.env.example`
**Changes**: add `"@faerrin/llm": "workspace:*"`, devDeps `zod` + `zod-to-json-schema`
(mirroring heartwood). Add to `.env.example`:

```sh
# Phase-2 LLM judge (surface judge). Required only for `surface judge`.
#ANTHROPIC_API_KEY=
#SURFACE_MODEL_JUDGE=claude-haiku-4-5-20251001
#SURFACE_MODEL_ESCALATE=claude-sonnet-4-6
```

#### 2. Config block
**File**: `pkg/content/scripts/config.ts`
**Changes**: add a `surface` section — judge/escalate model ids, chunk size (150),
overlap (10), confidence floor (0.6), escalation confidence band, `minClusterCount`.

#### 3. Content-local LLM helper
**File**: `pkg/content/scripts/lib/llm.ts` (new)
**Changes**: a minimal `complete()` mirroring `pkg/heartwood/src/llm.ts` — wraps
`@faerrin/llm` `AnthropicClient`, derives a forced tool from a Zod schema via
`zod-to-json-schema`, caches the lexicon system block (`SystemBlock{ cache: true }`),
logs cost via `@faerrin/llm`'s `costUSD`/`PRICING_USD_PER_1M`. **Does not import
heartwood.** Takes an injectable `LlmClient` for tests.

#### 4. Judge stage
**File**: `pkg/content/scripts/surface/judge.ts` (new)
**Changes**:
- Chunk a session into ~150-line windows (10-line overlap), each line rendered
  `[<lineRef>] (<speaker>) <text>`; **skip windows with zero Phase-1 candidates**.
- System prompt = three-way-classify instructions + the **full lexicon block**, sorted
  deterministically, marked `cache: true` (pad to clear the 4096-token tier minimum).
- Zod schema → forced tool:

```ts
const Candidate = z.object({
  lineRef: z.number().int(),
  span: z.string(),
  verdict: z.enum(["confirm","new","reject"]),
  suggestedCanonical: z.string().nullable(), // non-null only when confirm; ∈ lexicon
  confidence: z.number(),
  reason: z.string(),
})
const Result = z.object({ candidates: z.array(Candidate) })
```

- Model routing: Haiku 4.5 for all; re-judge with **Sonnet 4.6** when
  `confidence ∈ [0.4,0.75]` or a `confirm` has large phonetic distance. (Opus 4.8 noted
  as future option behind a client `temperature`-omit tweak.)
- `--mode full` skips the Phase-1 pre-filter and asks the model to find all
  mistranscriptions in each chunk (recall audit). Default `hybrid`.
- Backlog (`judge all`): note the Batches API (50% off) as the throughput path; initial
  implementation may use sequential calls with the lexicon cached after chunk 1.

#### 5. Deterministic guardrails
**File**: `pkg/content/scripts/surface/judge.ts`
**Changes**: after parsing, drop any candidate where `suggestedCanonical ∉ lexicon`
(exact, case-sensitive), or whose `span` is not found verbatim at `lineRef`; dedupe by
`(lineRef, span)`; never emit a pair whose variant equals its canonical.

#### 6. defs.yaml write-back (shared)
**Files**: `pkg/content/scripts/lib/defs.ts` (new), `pkg/content/scripts/review.ts` (refactor)
**Changes**: extract `addCorrection()` out of `review.ts` into `scripts/lib/defs.ts`,
and have `review.ts` import it (no behavior change for the UI). Extend it with:
- **dedupe**: skip a variant already present under the key (test against the compiled
  matcher, not just string equality); never add variant == key;
- **regex-escape** the literal span before adding via the existing `escapeRegex()`
  (`linker.ts:4`) — defs values are regex fragments (format kept by decision);
- **optional whitespace generalization**: replace inter-token spaces with `\s*` on
  multi-word variants so one entry covers spacing variants;
- preserve the existing `yaml.dump(..., { lineWidth: -1 })` formatting.
`surface judge --write` calls this for each confirmed `(suggestedCanonical, span)`.
Rejections/edits are appended to a gitignored side log (`scripts/.surface-log.jsonl`)
for threshold tuning — never into `defs.yaml`.

#### 7. Tests
**Files**: `judge.test.ts`, `defs.test.ts`, `llm.test.ts`
**Changes**: judge tests inject a stub `LlmClient` returning canned tool output
(DI pattern, no module mocking) and assert the guardrails drop hallucinated canonicals /
missing spans / dupes. `defs.test.ts` covers dedupe, regex-escaping, and quoting of
space/leading-digit variants (`"12 wins"`). `llm.test.ts` checks the lexicon block is
marked cached and the Zod tool is built.

### Success Criteria

#### Automated Verification
- [ ] Type checking passes: `bun run --filter @faerrin/content typecheck`
- [ ] Tests pass (with stub client, no live API): `bun run --filter @faerrin/content test`
- [ ] Whole workspace green: `bun --filter '*' typecheck && bun --filter '*' test`
- [ ] `review.ts` still imports and uses the extracted `addCorrection` (no UI regression in code)

#### Manual Verification
- [ ] `surface judge <date>` (live key) returns sensible confirm/new/reject verdicts
- [ ] `usage.cacheReadTokens > 0` on the 2nd+ chunk (lexicon caching actually engaged)
- [ ] `surface judge <date> --write` appends correct, regex-safe, deduped entries to `defs.yaml`
- [ ] After write-back + `bun run --filter @faerrin/content pipeline`, the garble is
      corrected at ingest and no longer re-flagged by `surface known`
- [ ] Sonnet escalation path runs without a `temperature` 400

**Implementation Note**: Pause after Phase 2 automated checks for the user to run a live
`judge` on a couple of sessions and confirm verdict quality + cache hits before any
bulk `judge all` run.

---

## Testing Strategy

### Unit Tests
- `normalize`: NFKD folding of Færrin/Anaïs; n-gram span reconstruction.
- `phonetics`: ensemble ranks known defs pairs (Tywelwyn, Hlarf, barghest variants) high;
  ranks unrelated words low.
- `english`: OOV gate accepts invented words, rejects common English.
- `lexicon`: built from a fixture defs + fixture wiki names; `nearest` ordering; Script excluded.
- `known`/`discover`: candidate emission, dedupe, clustering, `--min-count`.
- `judge`: stub-client verdicts + every guardrail; `defs`: dedupe/escape/quote.

### Integration Tests
- End-to-end Mode 1 over one real `scripts/data/*.json` fixture (no network).
- Write-back round-trip: confirm pair → `defs.yaml` updated → `loadCorrections()`
  replaces the garble.

### Manual Testing Steps
1. `surface known 2026-5-21` — inspect candidate quality.
2. `surface discover --min-count 3` — look for real recurring unknowns (the Eyestel/Istel class).
3. `surface judge 2026-5-21` then `--write`; re-run `pipeline`; confirm the garble is gone.

## Performance Considerations
- Phase 1 is offline and fast; build the BK-tree / lexicon index once per run.
- Phase 2 hybrid ≈ $0.10–0.20 per 1000-line session (Haiku, lexicon cached, ~15% Sonnet
  escalation); the 75-session backlog is a few dollars, halved via Batches. `full` mode
  is ~5–10× and reserved for periodic audits.

## Migration Notes
- `ANTHROPIC_API_KEY` must be added to `pkg/content/.env` (not present today; caster and
  heartwood keep their own). Bun auto-loads `.env` from the package cwd.
- If `@faerrin/llm` ever adds Opus support to the surfacer, add an Opus 4.8 row to
  `pkg/llm/src/pricing.ts` and omit `temperature` for Opus-tier in the client, or cost
  logging undercounts and the call 400s.

## References
- Research/discovery: `/octo:discover` session (this conversation) — library survey,
  ASR-correction prior art, verified Claude API facts (pricing, cache minimums,
  `effort`/Haiku, Batches, structured-output constraints).
- Current write-back: `pkg/content/scripts/review.ts:28` (`addCorrection`)
- Corrections compile: `pkg/content/scripts/lib/corrections.ts:13`
- Lexicon sources: `pkg/content/scripts/lib/content.ts:15` (`walkContent`),
  `pkg/content/scripts/lib/linker.ts:21` (`buildLinker`)
- LLM pattern to mirror: `pkg/heartwood/src/llm.ts:37` (`complete`),
  `pkg/llm/src/client.ts:99` (`AnthropicClient`)
- Data shape: `pkg/content/scripts/lib/types.ts`
