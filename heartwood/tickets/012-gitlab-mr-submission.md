id: 012
title: gitlab-mr-submission
parent: 001
type: task
author: jbassin
---

## Overview
Open one merge request per transcript with verified edits applied and speculative/contradicting claims surfaced as MR comments.

## Changes Required

### GitLab client
**File**: `src/gitlab/client.ts` (new)
**Changes**: Thin wrapper around GitLab REST API using `fetch`. Auth via `GITLAB_TOKEN` from `.env`. Methods: `getDefaultBranch()`, `createBranch(name, from)`, `commitFiles(branch, files, message)`, `createMergeRequest({title, description, sourceBranch, targetBranch})`, `addNote(mrIid, body)`.

### Apply + commit
**File**: `src/gitlab/submit.ts` (new)
**Changes**: Per transcript: create branch `wiki/<transcript-basename>` from default branch, apply verified edits (literal `oldText` → `newText` replace; `create` writes new files; `append` inserts after heading), commit with message `wiki: integrate <transcript-basename>` and a body listing every (file, citation-lines) pair.

### MR body + comments
**File**: `src/gitlab/submit.ts`
**Changes**: MR title: `Wiki: <campaign-name> <session-date>`. Body: summary counts (claims extracted, edits applied, verifier rejects, speculative comments), table of files changed with citation links, and a "How to review" section reminding the human that every claim is line-cited. After MR creation, post one note per (a) speculative claim (b) contradict-type proposal (c) verifier-rejected proposal — each note quotes the relevant transcript lines.

### Ledger update
**File**: `src/transcript/ledger.ts`
**Changes**: `stages.prOpened` timestamp and `prUrl` recorded on success.

### CLI
**File**: `src/cli/submit.ts` (new)
**Changes**: `bun run submit <transcript>` and `bun run submit --all`. `--dry-run` writes the patch + MR description to `state/dry-runs/` instead of pushing.

## Success Criteria

### Automated Verification
- [ ] `--dry-run` produces a valid patch that applies cleanly against a fresh checkout
- [ ] Unit tests cover the apply step: ambiguous `oldText` errors out, unique `oldText` succeeds
- [ ] Branch name collisions are handled (suffix `-2`, `-3`, …)
- [ ] Ledger correctly records `prUrl` on success and `errors` on failure

### Manual Verification
- [ ] Open one real MR against a test GitLab project and verify: branch exists, files changed match expectations, MR body renders, comments are posted, every citation link is clickable
- [ ] Verify token has only the permissions needed (create branch, push, open MR) — no broader scope
