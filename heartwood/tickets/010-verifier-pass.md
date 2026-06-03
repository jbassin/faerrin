id: 010
title: verifier-pass
parent: 001
type: task
author: jbassin
---

## Overview
Independent verification that every proposal's claim is actually supported by its cited transcript lines. Different LLM invocation, no shared context with the proposer.

## Changes Required

### Verifier
**File**: `src/reconcile/verify.ts` (new)
**Changes**: For each proposed edit, load ONLY the cited line ranges from the transcript + the diff between `oldText` and `newText` (or full `content` for new pages). Call `MODEL_VERIFY` (default Sonnet 4.6) with a strict yes/no schema: `{ supported: boolean, reason: string, missingFromCitation: string[] }`. The system prompt is deliberately adversarial: "find anything in the proposed change that is not literally stated or directly implied by the cited lines."

### Filter
**File**: `src/reconcile/verify.ts`
**Changes**: Proposals where `supported: false` are dropped from the per-transcript edit set and recorded separately in `state/verifier-rejects/<filename>.json` (kept for audit and inclusion in MR description as transparency).

### CLI
**File**: `src/cli/verify.ts` (new)

## Success Criteria

### Automated Verification
- [ ] Synthetic test: inject a hallucinated detail into a proposal, verifier rejects it
- [ ] Synthetic test: a proposal exactly quoting the transcript is accepted
- [ ] Every accepted proposal has a verifier record with `supported: true`
- [ ] Rejected proposals are written to the audit dir, not silently dropped

### Manual Verification
- [ ] On golden-set transcripts, no rejected proposal turns out to have been correct (i.e. no false rejects on a hand-graded sample of 20)
- [ ] No accepted proposal turns out to be unsupported (false-accept rate of 0 on the golden set is the bar to ship)
