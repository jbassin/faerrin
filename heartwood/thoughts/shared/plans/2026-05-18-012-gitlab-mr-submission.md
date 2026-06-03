# Ticket 012: GitLab MR Submission — Implementation Plan

## Overview

Per transcript, create a GitLab branch, apply all non-comment proposals as file commits, open a merge request with a structured body, and post one MR note per `CommentProposal`. Record `prUrl` in the ledger and mark `verified` (no-op pass-through) then `prOpened`.

## Current State Analysis

- `LedgerEntry` already has `prOpened: string | null` and `prUrl?: string` — no schema changes needed.
- `config.ts` validates `GITLAB_TOKEN` and `GITLAB_PROJECT_ID` but has **no host URL**.
- Proposals file (`state/proposals/<filename>.json`) contains `Proposal[]` where `EditProposal`, `CreateProposal`, `AppendProposal` become file commits and `CommentProposal` (reason `speculative` | `contradict`) become MR notes.
- `parseFilename()` in `src/transcript/discover.ts` extracts `campaignName` (kebab-case) and `sessionDate` from any ledger `filename`.
- `src/cli/propose.ts` is the template for all CLI structure, options interface, `--all` dispatch, error handling, and ledger writes.
- Tickets 010/011 (verification stage) are closed as WILL_NOT_DO. Submit marks `stages.verified` as a no-op pass-through then `stages.prOpened`.

## Desired End State

Running `bun run submit <transcript>` or `bun run submit --all`:
- Opens one real MR per transcript against the configured GitLab project.
- Branch `wiki/<transcript-basename>` (with `-2`, `-3`, … suffix on collision) exists in GitLab with all file changes committed.
- MR body shows summary counts, a table of changed files with citation links, and a "How to review" section.
- One MR note posted per `CommentProposal`.
- Ledger entry has `stages.verified`, `stages.prOpened`, and `prUrl` set.
- `--dry-run` writes `state/dry-runs/<basename>/` with `changes.json`, `mr-description.md`, and `notes.json` instead of pushing to GitLab.

### Key Discoveries

- `STAGE_ORDER` = `['segmented','extracted','resolved','matched','proposed','verified','prOpened']` — `verified` and `prOpened` already exist; submit marks both.
- `setPrUrl(ledger, filename, prUrl)` already exists in `ledger.ts:174`.
- `GITLAB_PROJECT_ID` is passed through `encodeURIComponent()` in the client so it works with both numeric IDs and `namespace/project` strings.
- Citations are `[lineStart, lineEnd]` tuples (1-based, inclusive). Citation links are built from `project.webUrl` returned by the GitLab API: `${webUrl}/-/blob/${defaultBranch}/transcripts/${filename}#L${start}[-${end}]`.
- The apply step accumulates in-memory file contents (`Map<string, string>`) and applies proposals sequentially, so multiple edits to the same file work correctly.

## What We're NOT Doing

- No actual verification/LLM review of proposals (tickets 010/011 WILL_NOT_DO).
- No deletion of wiki pages.
- No handling of `alias-edit` clusters as a separate GitLab concern — they produce `EditProposal` entries and are treated identically to other edits.
- No webhook or CI integration.
- No automatic retry on transient GitLab API failures (one attempt per transcript; errors go to ledger).

## Implementation Approach

Five phases in dependency order. Phases 1–2 are pure infrastructure with no pipeline dependencies. Phases 3–4 build the core logic. Phase 5 wires everything together.

---

## Phase 1: Config Update + GitLab Client

### Overview

Add `GITLAB_URL` to config and build a thin `fetch`-based GitLab API client.

### Changes Required

#### 1. `src/config.ts`

**File**: `src/config.ts`
**Changes**: Add `GITLAB_URL` to `REQUIRED` array and `Config` interface.

```typescript
const REQUIRED = ['ANTHROPIC_API_KEY', 'GITLAB_TOKEN', 'GITLAB_PROJECT_ID', 'GITLAB_URL'] as const;

export interface Config {
  ANTHROPIC_API_KEY: string;
  GITLAB_TOKEN:      string;
  GITLAB_PROJECT_ID: string;
  GITLAB_URL:        string;   // e.g. https://gitlab.com
  // ... model fields unchanged
}

// Inside config():
GITLAB_URL: Bun.env.GITLAB_URL!,
```

#### 2. `src/gitlab/client.ts` (new)

**File**: `src/gitlab/client.ts`
**Changes**: Thin `fetch` wrapper. All methods throw on non-2xx responses with the GitLab error message included.

```typescript
export interface CommitAction {
  action:   'create' | 'update';
  filePath: string;   // path in the repo, e.g. 'content/Geography/Calaria/Hallia/index.md'
  content:  string;   // full file content (text encoding)
}

export interface ProjectInfo {
  defaultBranch: string;
  webUrl:        string;
}

export interface MergeRequestResult {
  iid:    number;
  webUrl: string;
}

export interface GitLabClient {
  getProject():     Promise<ProjectInfo>;
  branchExists(name: string): Promise<boolean>;
  createBranch(name: string, from: string): Promise<void>;
  commitFiles(branch: string, actions: CommitAction[], message: string): Promise<void>;
  createMergeRequest(opts: {
    title:        string;
    description:  string;
    sourceBranch: string;
    targetBranch: string;
  }): Promise<MergeRequestResult>;
  addNote(mrIid: number, body: string): Promise<void>;
}

export function createClient(baseUrl: string, token: string, projectId: string): GitLabClient {
  const projectUrl = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${projectUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitLab API ${method} ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  return {
    async getProject() {
      const data = await request('GET', '') as { default_branch: string; web_url: string };
      return { defaultBranch: data.default_branch, webUrl: data.web_url };
    },
    async branchExists(name) {
      const res = await fetch(
        `${projectUrl}/repository/branches/${encodeURIComponent(name)}`,
        { headers },
      );
      if (res.status === 404) return false;
      if (res.ok) return true;
      throw new Error(`branchExists check failed (${res.status})`);
    },
    async createBranch(name, from) {
      await request('POST', '/repository/branches', { branch: name, ref: from });
    },
    async commitFiles(branch, actions, message) {
      await request('POST', '/repository/commits', {
        branch,
        commit_message: message,
        actions: actions.map((a) => ({
          action:    a.action,
          file_path: a.filePath,
          content:   a.content,
          encoding:  'text',
        })),
      });
    },
    async createMergeRequest({ title, description, sourceBranch, targetBranch }) {
      const data = await request('POST', '/merge_requests', {
        title,
        description,
        source_branch: sourceBranch,
        target_branch: targetBranch,
      }) as { iid: number; web_url: string };
      return { iid: data.iid, webUrl: data.web_url };
    },
    async addNote(mrIid, body) {
      await request('POST', `/merge_requests/${mrIid}/notes`, { body });
    },
  };
}
```

#### 3. `src/gitlab/client.test.ts` (new)

**File**: `src/gitlab/client.test.ts`
**Changes**: Use `fetch` mock via `Bun.serve()` local test server or mock via module override.

Test cases:
- `getProject()` maps `default_branch` + `web_url` correctly.
- `branchExists()` returns `true` on 200, `false` on 404, throws on 500.
- `createBranch()` throws with GitLab message on non-2xx.
- `commitFiles()` serializes `file_path` (not `filePath`) and `encoding: 'text'`.
- `addNote()` posts to correct endpoint.

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test src/gitlab/client.test.ts` passes

---

## Phase 2: Apply Step + Dry-Run

### Overview

Build the core logic that converts a `Proposal[]` into `CommitAction[]` (file edits applied in memory) and the dry-run output writer.

### Changes Required

#### 1. `src/gitlab/apply.ts` (new)

**File**: `src/gitlab/apply.ts`
**Changes**: Pure functions; no I/O except reading from `contentDir`.

```typescript
import type { Proposal, EditProposal, CreateProposal, AppendProposal } from '../reconcile/propose';
import type { CommitAction } from './client';

export interface ApplyContext {
  contentDir: string;
}

// Returns CommitAction[] for all non-comment proposals.
// Reads files from contentDir on first access; accumulates changes in memory.
// Throws if:
//   - edit: oldText not found (count === 0)
//   - edit: oldText not unique (count > 1)
//   - append: afterHeading not found in file
//   - create: path already has content in files map (duplicate create)
export async function buildCommitActions(
  proposals: Proposal[],
  ctx: ApplyContext,
): Promise<CommitAction[]>
```

**Apply rules:**

- **edit**: Read current content (from map or disk). Count occurrences of `oldText` — error if ≠ 1. Replace with `newText`. Store in map. Action type: file existed → `'update'`.
- **create**: Content must not already be in the map. Write `proposal.content` directly. Action type: `'create'`.
- **append** (`afterHeading === null`): Read current content. Append `'\n\n' + proposal.content` (trim trailing newline from current first). Store in map. Action type: `'update'`.
- **append** (`afterHeading !== null`): Find the line containing the heading (matching `/^#{1,6}\s+<heading>$/m`). Insert `'\n\n' + proposal.content` immediately after that line. Throw if heading not found. Action type: `'update'`.
- **comment**: Skip — becomes an MR note, not a file change.

File paths in `CommitAction.filePath` are `'content/' + proposal.path` (adding the repo-root prefix).

#### 2. `src/gitlab/apply.test.ts` (new)

**File**: `src/gitlab/apply.test.ts`
**Changes**: All tests use in-memory file content via a fake `contentDir` (temp directory).

Test cases:
- Edit: unique `oldText` succeeds, produces `'update'` action.
- Edit: `oldText` count 0 → throws.
- Edit: `oldText` count 2 → throws.
- Edit: two proposals on the same file applied sequentially (second sees first's output).
- Create: produces `'create'` action with correct content.
- Create: duplicate path (two creates for same file) → throws.
- Append `afterHeading === null`: appends to file end.
- Append `afterHeading !== null`: inserts after correct heading.
- Append: heading not found → throws.
- Comment proposal: skipped (not in output).

#### 3. `src/gitlab/dry-run.ts` (new)

**File**: `src/gitlab/dry-run.ts`
**Changes**: Writes dry-run artifacts to `state/dry-runs/<basename>/`.

```typescript
export interface DryRunOutput {
  dryRunDir:     string;   // state/dry-runs/<basename>
  changesPath:   string;   // .../changes.json
  descriptionPath: string; // .../mr-description.md
  notesPath:     string;   // .../notes.json
}

export async function writeDryRun(
  basename:    string,
  actions:     CommitAction[],
  description: string,
  notes:       string[],
  dryRunsDir:  string,
): Promise<DryRunOutput>
```

Directory: `state/dry-runs/<basename>/` where `basename` is `entry.filename` without `.txt`.
Files: `changes.json` (pretty-printed `CommitAction[]`), `mr-description.md`, `notes.json` (pretty-printed `string[]`).
Write via tmp+rename pattern (same as rest of codebase).

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test src/gitlab/apply.test.ts` passes
- [x] `bun test src/gitlab/dry-run.test.ts` passes (basic: dir created, files written)

---

## Phase 3: Full Submit Logic

### Overview

Combine the apply step, GitLab client calls, MR body generation, and ledger updates into a `submitOne` function.

### Changes Required

#### 1. `src/gitlab/submit.ts` (new)

**File**: `src/gitlab/submit.ts`
**Changes**: Orchestrator for one transcript's submission.

```typescript
import { createClient, type GitLabClient } from './client';
import { buildCommitActions } from './apply';
import { writeDryRun } from './dry-run';
import { parseFilename } from '../transcript/discover';
import { markStage, setPrUrl, recordError, type Ledger, type LedgerEntry } from '../transcript/ledger';
import type { Proposal, CommentProposal } from '../reconcile/propose';
import { config } from '../config';

export interface SubmitCtx {
  transcriptsDir: string;
  ledgerPath:     string;
  proposalsDir:   string;
  contentDir:     string;
  dryRunsDir:     string;
  dryRun:         boolean;
  clientFn?:      (baseUrl: string, token: string, projectId: string) => GitLabClient;
}
```

**`submitOne(entry, ledger, ctx)` algorithm:**

1. Read `state/proposals/<filename>.json`. Throw if missing.
2. Guard: `proposalsData.contentHash !== entry.contentHash` → throw stale-input error.
3. Call `buildCommitActions(proposals, { contentDir: ctx.contentDir })`.
4. Build MR body string (see below).
5. Collect notes: one per `CommentProposal`.
6. **Dry-run path**: call `writeDryRun(...)`, log output paths, return ledger unchanged (do not mark any stages).
7. **Live path**:
   a. Init client: `(ctx.clientFn ?? createClient)(config().GITLAB_URL, config().GITLAB_TOKEN, config().GITLAB_PROJECT_ID)`.
   b. `getProject()` → `{ defaultBranch, webUrl }`.
   c. `findAvailableBranch(client, basename)` → branch name.
   d. `createBranch(branch, defaultBranch)`.
   e. Build commit message: `wiki: integrate <basename>\n\n<list of "content/<path> (lines X–Y)" per changed file>`.
   f. `commitFiles(branch, actions, commitMessage)`.
   g. `createMergeRequest({ title, description, sourceBranch: branch, targetBranch: defaultBranch })` → `{ iid, webUrl: mrUrl }`.
   h. For each note: `addNote(mrIid, noteBody)`.
   i. `ledger = markStage(ledger, filename, 'verified')`.
   j. `ledger = markStage(ledger, filename, 'prOpened')`.
   k. `ledger = setPrUrl(ledger, filename, mrUrl)`.
   l. Write ledger. Log success.
   m. Return updated ledger.

**`findAvailableBranch(client, basename)`:**

```typescript
async function findAvailableBranch(client: GitLabClient, basename: string): Promise<string> {
  const base = `wiki/${basename}`;
  if (!(await client.branchExists(base))) return base;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`;
    if (!(await client.branchExists(candidate))) return candidate;
  }
  throw new Error(`no available branch name found for ${base} after 50 attempts`);
}
```

**MR title:** `Wiki: <Title Case campaign name> <sessionDate>`

Example: filename `000.through-a-song-darkly.2025-8-28.txt` → title `Wiki: Through a Song Darkly 2025-08-28`

Title-case conversion: split `campaignName` on `-`, capitalize first letter of each word, join with spaces. Keep particles lowercase (no exceptions — always capitalize every word for simplicity).

**MR body format:**

```markdown
## Summary

| Stat | Count |
|------|-------|
| Clusters processed | {stats.totalClusters} |
| Edits applied | {edits+appends+creates} ({edit} edit, {append} append, {create} create) |
| Speculative comments | {commentProposals.filter(speculative).length} |
| Contradictions | {commentProposals.filter(contradict).length} |

## Files Changed

| File | Citations |
|------|-----------|
| `content/path/to/file.md` | [1230](url#L1230), [1879–1881](url#L1879-1881) |

## How to Review

Every change in this MR is backed by specific lines in the session transcript. Citation links above open the exact lines. Speculative claims and contradictions are posted as MR comments for human review — they are not applied to the wiki automatically.
```

Citation URL format (single line): `${webUrl}/-/blob/${defaultBranch}/transcripts/${filename}#L${line}`
Citation URL format (range): `${webUrl}/-/blob/${defaultBranch}/transcripts/${filename}#L${start}-${end}`
Link text: `${start}` for single line, `${start}–${end}` for range (em dash).

The "Files Changed" table is built from `CommitAction[]`. For each action, collect all `citations` from the proposals that contributed to that file. Deduplicate and sort.

**Note body format (one per `CommentProposal`):**

```markdown
**[Speculative]** — `content/path/to/file.md`

{proposal.message}

Citations: [1230](url#L1230), [1231–1235](url#L1231-1235)
```

For `contradict`: replace `[Speculative]` with `[Contradiction]`.
For `relatedPath === null`: replace the path with `(no related page)`.

**Stats for MR body:** Read `stats` from the proposals JSON (already on the `proposalsData` object).

#### 2. `src/gitlab/submit.test.ts` (new)

**File**: `src/gitlab/submit.test.ts`
**Changes**: Mock `GitLabClient` via `clientFn` override.

Test cases:
- `submitOne` calls `getProject`, `branchExists`, `createBranch`, `commitFiles`, `createMergeRequest`, `addNote` in order.
- Branch collision: if `branchExists('wiki/foo')` returns true, tries `wiki/foo-2`.
- Dry-run path: no client calls made, output files written to `dryRunsDir`.
- Ledger has `verified`, `prOpened`, and `prUrl` set on success.
- Commit message includes one line per changed file with citation ranges.
- MR title: title-case campaign name + session date.
- Note body includes `[Speculative]` / `[Contradiction]` prefix, path, message, citation links.
- Stale proposals (contentHash mismatch) → throws without calling any client methods.
- Missing proposals file → throws without calling any client methods.
- Client error on `commitFiles` → error recorded in ledger, stage not set.

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test src/gitlab/submit.test.ts` passes

---

## Phase 4: CLI + Wiring

### Overview

Add `src/cli/submit.ts` following the exact pattern of `src/cli/propose.ts`, then register the command.

### Changes Required

#### 1. `src/cli/submit.ts` (new)

**File**: `src/cli/submit.ts`
**Changes**: Standard CLI shell.

```typescript
const TRANSCRIPTS_DIR = 'transcripts';
const LEDGER_PATH     = 'state/processed.json';
const PROPOSALS_DIR   = 'state/proposals';
const CONTENT_DIR     = 'content';
const DRY_RUNS_DIR    = 'state/dry-runs';

export interface SubmitCliOptions {
  transcriptsDir?: string;
  ledgerPath?:     string;
  proposalsDir?:   string;
  contentDir?:     string;
  dryRunsDir?:     string;
  dryRun?:         boolean;
  clientFn?:       (baseUrl: string, token: string, projectId: string) => GitLabClient;
}
```

Usage: `bun run submit [--dry-run] <name>` or `bun run submit [--dry-run] --all`

`--all` filter: `e.stages.proposed !== null && e.stages.prOpened === null`

Gate for single transcript: requires `stages.proposed !== null`.

Error handling: same pattern as `propose.ts` — catch per-transcript errors, record in ledger, accumulate failures, throw at end of `--all` run.

No `config()` call in `submit.ts` itself — the `submitOne` function reads config. This means `SubmitCliOptions.clientFn` allows tests to skip config validation.

#### 2. `src/cli/submit.test.ts` (new)

**File**: `src/cli/submit.test.ts`
**Changes**: Integration-level test following `propose.test.ts` pattern.

Test cases:
- No argv → prints usage and exits 1.
- Named transcript not found → exits 1.
- Named transcript not yet proposed → exits 1 with helpful message.
- `--all` with nothing ready → logs "nothing to submit" and returns.
- `--dry-run --all` with one ready transcript → calls dry-run path, no real GitLab calls.
- Ledger correctly written after mock success.

#### 3. `src/cli/index.ts`

**File**: `src/cli/index.ts`
**Changes**: Add `submit` import and handler.

```typescript
import { submit } from './submit';
// ...
export const handlers: Record<string, CliHandler> = {
  // ... existing handlers
  'submit': submit,
};
```

#### 4. `package.json`

**File**: `package.json`
**Changes**: Add `submit` script.

```json
"submit": "bun index.ts submit"
```

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test src/cli/submit.test.ts` passes
- [x] `bun test` (full suite) passes with no regressions

#### Manual Verification
- [x] `bun run submit --dry-run 000` writes `state/dry-runs/000.through-a-song-darkly.2025-8-28/` with all three files
- [x] `changes.json` contains one entry per non-comment proposal with correct `action` type
- [x] `mr-description.md` renders correctly in a Markdown viewer (table aligned, citation links correct format)
- [x] `notes.json` contains one entry per `CommentProposal` with correct prefix label

---

## Phase 5: Live MR Verification (Manual Only)

### Success Criteria

#### Manual Verification
- [x] `bun run submit 000` opens a real MR against the configured GitLab project
- [x] Branch `wiki/000.through-a-song-darkly.2025-8-28` (or `-2` variant) exists in GitLab
- [x] Files changed in the MR match the proposals exactly
- [x] MR body renders: summary table, files table with clickable citation links, "How to review" section
- [x] One MR note per `CommentProposal` posted, each with correct prefix and citation links
- [x] Ledger entry: `stages.verified`, `stages.prOpened`, and `prUrl` all set
- [ ] `GITLAB_TOKEN` scope is limited to create branch + push + open MR (no broader permissions)

---

## Testing Strategy

### Unit Tests
- `client.test.ts`: HTTP method/path/body serialization; error message extraction; `branchExists` 404 handling.
- `apply.test.ts`: All apply rules (edit/create/append), error cases, multi-proposal-same-file ordering.
- `submit.test.ts`: Full `submitOne` flow with mocked client; dry-run; ledger state; note/MR body content.
- `cli/submit.test.ts`: CLI argument parsing, stage gates, `--all` filtering.

### Manual Testing Steps
1. Run `bun run submit --dry-run 000` and inspect output files.
2. Confirm `changes.json` paths all start with `content/` and action types are correct.
3. Confirm `mr-description.md` has correct stats and citation URL structure.
4. Run live `bun run submit 000` and verify MR in GitLab UI.
5. Click a citation link and verify it opens the correct transcript line.

## References

- Ticket: `tickets/012-gitlab-mr-submission.md`
- CLI template: `src/cli/propose.ts`
- Ledger schema: `src/transcript/ledger.ts`
- Proposal types: `src/reconcile/propose.ts`
- Transcript metadata: `src/transcript/discover.ts` (`parseFilename`)
- Config: `src/config.ts`
- Sample proposals: `state/proposals/000.through-a-song-darkly.2025-8-28.txt.json`
