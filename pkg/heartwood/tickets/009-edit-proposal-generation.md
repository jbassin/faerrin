id: 009
title: edit-proposal-generation
parent: 001
type: task
author: jbassin
---

## Overview
Turn `new` and `update` matches into concrete markdown edits that respect the wiki's conventions (frontmatter, wikilinks, callouts).

## Changes Required

### Proposer
**File**: `src/reconcile/propose.ts` (new)
**Changes**: For each `update` cluster (grouped by target page), call `MODEL_PROPOSE` (default Sonnet 4.6). System context (cached): the relevant section of `CLAUDE.md` documenting Obsidian conventions + the target page's full text. User context: the claims to incorporate.

Output schema (one of):
```ts
{ kind: 'edit', path: string, oldText: string, newText: string, citations: [number, number][] }
{ kind: 'create', path: string, content: string, citations: [number, number][] }
{ kind: 'append', path: string, afterHeading: string|null, content: string, citations: [number, number][] }
```

`oldText` must be a literal substring of the current page for `edit` (so the apply step can do an unambiguous replace). `citations` is non-empty for every edit.

For `contradict` matches: generate an MR-comment-only proposal rather than an edit (humans decide).

For `speculative` claims (any role): MR-comment-only.

Pages under `content/Rules/` are excluded from `edit`/`create`/`append` outputs (per scope).

### Persistence
**File**: `state/proposals/<filename>.json`

### CLI
**File**: `src/cli/propose.ts` (new)

## Success Criteria

### Automated Verification
- [ ] Every `edit` proposal's `oldText` is found exactly once in the target file
- [ ] Every proposal has `citations` non-empty and all citation ranges fall inside `ic`/`recap` segments
- [ ] No proposal targets `content/Rules/`
- [ ] Generated `newText` parses as valid markdown (no broken frontmatter)
- [ ] New pages include frontmatter consistent with sibling pages (lint rule)

### Manual Verification
- [ ] Apply 5 proposals against a clone of `content/` and verify the rendered output in an Obsidian-compatible previewer looks correct (wikilinks resolve, callouts render)
