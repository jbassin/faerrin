id: 008
title: claim-to-page-matching
parent: 001
type: task
author: jbassin
---

## Overview
For each claim, find candidate wiki pages it touches and classify the relationship: `new` (no existing page), `consistent` (already covered, no edit), `update` (extends existing page), or `contradict` (conflicts with existing page).

## Changes Required

### Candidate retrieval
**File**: `src/reconcile/candidates.ts` (new)
**Changes**: Two-stage. (a) Fast: for each entity in `claim.entities`, look it up in the wiki index by title/alias/wikilink-target. (b) LLM-assisted fallback when no fast match: send the claim + top-N index summaries to `MODEL_MATCH` and ask "which pages, if any, does this claim relate to?" — cache the index summaries.

### Classifier
**File**: `src/reconcile/classify.ts` (new)
**Changes**: For each `(claim, candidatePage)` pair where the page exists, fetch the full page text and call `MODEL_MATCH`. Schema: `{ pageRelation: 'new'|'consistent'|'update'|'contradict', rationale: string, relevantPageExcerpt: string|null }`. For `new`, no page is loaded.

### Persistence
**File**: `state/matches/<filename>.json`
**Changes**: `[{ claim, candidatePages: [{ path, relation, rationale, excerpt }] }]`

### CLI
**File**: `src/cli/match.ts` (new)

## Success Criteria

### Automated Verification
- [ ] Every claim has at least one candidate page OR is classified as standalone `new`
- [ ] No more than top-3 candidate pages per claim (cost cap)
- [ ] Pages loaded for full-text inspection are logged; total bytes loaded per transcript is bounded (target: <500KB per transcript)

### Manual Verification
- [ ] Hand-check: a known fact already in the wiki is classified `consistent` (no false-positive updates)
- [ ] Hand-check: a deliberately injected contradiction is classified `contradict`
