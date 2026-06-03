id: 011
title: evaluation-harness
parent: 001
type: task
author: jbassin
---

## Overview
Golden-set evaluation so we can measure pipeline quality before opening real MRs, and detect regressions when prompts or models change.

## Changes Required

### Golden set
**File**: `eval/golden/<transcript>.json` (new, hand-authored)
**Changes**: Pick 3–5 transcripts (mix of main + side campaigns). For each, hand-author an expected-output file: `{ expectedClaims: [{ claim, lines, role, mustAppear: boolean }], expectedPageTouches: [{ path, relation }] }`.

### Scorer
**File**: `src/eval/score.ts` (new)
**Changes**: Runs the full pipeline on each golden transcript and computes: claim recall (% of `mustAppear: true` expected claims that show up), claim precision (% of extracted claims that have a fuzzy match in expected), page-touch precision/recall, verifier-reject rate, total cost.

### CLI + thresholds
**File**: `src/cli/eval.ts` (new)
**Changes**: `bun run eval` outputs a report and exits non-zero if metrics fall below configured floors (target floors: claim recall ≥0.8, claim precision ≥0.9, page-touch precision ≥0.95).

## Success Criteria

### Automated Verification
- [ ] `bun run eval` runs end-to-end on the golden set and produces a metrics report
- [ ] Eval exits non-zero when thresholds are not met (test by raising a threshold)

### Manual Verification
- [ ] Initial eval run meets the configured thresholds — if not, iterate on prompts (in ticket 007/009/010) before shipping ticket 012
- [ ] Threshold floors are calibrated against actual baseline scores (don't set unrealistic bars)
