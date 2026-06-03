# Wiki Page Summarization Implementation Plan

## Overview

Enrich each wiki index entry with an LLM-generated summary, key facts, and entity lists.
Incremental by design: only pages whose `contentHash` changed (or that have no summary yet)
get re-summarized. A full re-index from scratch costs ~$0.14 at current Sonnet 4.6 pricing.

## Current State Analysis

- `src/wiki/load.ts` already writes `summary: null, keyFacts: null` for every page — the field
  stubs exist.
- `src/wiki/index-schema.ts` declares `summary: string | null; keyFacts: string[] | null` —
  `entities` is **not yet present** and must be added.
- `writeIndex` (`load.ts:145`) uses a direct `Bun.write` — not atomic; must be upgraded.
- `diffIndex` (`load.ts:156`) compares per-page `contentHash` — same logic reused for
  incremental detection.
- `complete()` in `src/llm.ts` already handles `cached` system blocks and Zod-schema tool-use.
- `recordLLMCall` accepts a `page` field — will be populated in this ticket.
- Three 0-byte stubs exist: `Godhome.md`, `Firmament.md`, `Stillness.md`. Body-empty pages
  receive a placeholder summary instead of an LLM call.

## Desired End State

`bun run index-wiki` runs parse → merge → summarize → atomic write. A second run with
no content changes makes zero LLM calls. Touching one file resumes exactly that page.
All 93 page entries have non-null `summary`, `keyFacts`, and `entities`.

### Key Discoveries
- `load.ts:48-60` initializes both nullable fields — Phase 1 adds `entities: null` here.
- `load.ts:145-147` needs atomic upgrade — write to `<path>.tmp` then `rename()`.
- `src/llm.ts:36-39` — `cached` arg puts text in a system block with `cache_control: ephemeral`.
- `src/cli/index-wiki.ts:6-30` — existing `--check` mode must stay untouched; new flags
  added alongside it.

## What We're NOT Doing

- Concurrency / parallelism — sequential is fine for 93 pages; revisit if wiki grows large.
- Retry logic — a single LLM failure skips the page, is logged, and causes a non-zero exit.
- Per-page progress persistence — the merged index is only written once at the end; a
  mid-run crash means pages from that run get re-tried next run (summaries carry forward
  from the prior on-disk index).
- Vector embeddings or semantic search on summaries — those belong in a later ticket.
- Changing the `--check` mode behavior.

## Implementation Approach

Four sequential phases: schema/plumbing first, then the LLM logic, then CLI wiring, then tests.
Dependency injection (`completeFn` optional parameter) keeps summarize.ts testable without
module mocking.

---

## Phase 1: Schema Extension + Atomic Write + Merge Helper

### Overview
Add `entities` to `PageRecord`, upgrade `writeIndex` to atomic, add `mergeIndex` to carry
forward summaries for unchanged pages.

### Changes Required

#### 1. `src/wiki/index-schema.ts`

Add `entities` to `PageRecord`:

```ts
export interface Entities {
  people: string[];
  places: string[];
  orgs: string[];
}

export interface PageRecord {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  img: string | null;
  headings: Heading[];
  wikilinks: WikilinkRecord[];
  contentHash: string;
  byteLength: number;
  summary: string | null;
  keyFacts: string[] | null;
  entities: Entities | null;   // ← new
}
```

#### 2. `src/wiki/load.ts`

Initialize `entities: null` in the page builder (line 58 area):

```ts
pages[raw.path] = {
  ...existing fields...
  summary: null,
  keyFacts: null,
  entities: null,   // ← new
};
```

Upgrade `writeIndex` to atomic using a temp file + rename:

```ts
import { rename } from 'node:fs/promises';

export async function writeIndex(index: WikiIndex, indexPath: string): Promise<void> {
  const tmp = `${indexPath}.tmp`;
  await Bun.write(tmp, JSON.stringify(index, null, 2) + '\n');
  await rename(tmp, indexPath);
}
```

Add `mergeIndex` helper — carries forward summaries for pages whose contentHash hasn't changed:

```ts
export function mergeIndex(fresh: WikiIndex, ondisk: WikiIndex): WikiIndex {
  const pages: Record<string, PageRecord> = {};
  for (const [path, page] of Object.entries(fresh.pages)) {
    const stored = ondisk.pages[path];
    if (
      stored &&
      stored.contentHash === page.contentHash &&
      stored.summary !== null
    ) {
      pages[path] = {
        ...page,
        summary: stored.summary,
        keyFacts: stored.keyFacts,
        entities: stored.entities,
      };
    } else {
      pages[path] = page;
    }
  }
  return { ...fresh, pages };
}
```

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes with the new `entities` field
- [x] `bun test src/wiki/load.test.ts` — existing 7 tests still pass
- [x] New test: `mergeIndex` carries forward summary/keyFacts/entities when contentHash matches
- [x] New test: `mergeIndex` leaves null when contentHash differs
- [ ] New test: `writeIndex` writes the file and temp file is cleaned up

---

## Phase 2: Summarizer Module

### Overview
`src/wiki/summarize.ts` — reads a page from disk, detects stubs, calls the LLM with a
structured Zod schema, returns enriched fields. Accepts an injected `completeFn` for testing.

### Changes Required

#### `src/wiki/summarize.ts` (new)

```ts
import { z } from 'zod';
import { type CompleteArgs, complete as defaultComplete } from '../llm';
import { config } from '../config';
import { parseFrontmatter } from './frontmatter';
import type { PageRecord, Entities } from './index-schema';

// Zod schema — length caps match ticket spec exactly
const SummarySchema = z.object({
  summary:  z.string().max(200),
  keyFacts: z.array(z.string().max(120)).max(8),
  entities: z.object({
    people: z.array(z.string()),
    places: z.array(z.string()),
    orgs:   z.array(z.string()),
  }),
});

// Cached across all pages in a run — tells the model what it's looking at
const WIKI_SYSTEM_PROMPT = `\
You are summarizing articles from a living wiki for a Pathfinder 2e tabletop campaign set in a\
 custom world. The wiki covers: deities (with stat blocks), geographic regions and cities,\
 organizations and their members, world phenomena, and rules articles.\
\n\nFor each page you will emit:\
\n- summary: one to two sentences that accurately describe the page subject. Must be factual.\
\n- keyFacts: up to 8 short bullet points, each a concrete fact present in the page text.\
\n- entities: lists of named people, places, and organizations mentioned in the page.\
\n\nNEVER invent information. Only include facts that appear in the provided page text.`;

export interface SummarizePageOptions {
  model: string;
  completeFn?: typeof defaultComplete;
}

export interface SummarizeResult {
  summary: string;
  keyFacts: string[];
  entities: Entities;
}

const PLACEHOLDER: SummarizeResult = {
  summary: '(stub page — no content yet)',
  keyFacts: [],
  entities: { people: [], places: [], orgs: [] },
};

export async function summarizePage(
  page: PageRecord,
  contentDir: string,
  opts: SummarizePageOptions,
): Promise<SummarizeResult> {
  const raw = await Bun.file(`${contentDir}/${page.path}`).text();
  const { body } = parseFrontmatter(raw, page.path);

  if (body.trim() === '') return PLACEHOLDER;

  const fn = opts.completeFn ?? defaultComplete;
  const result = await fn({
    stage: 'summarize',
    page:  page.path,
    model: opts.model,
    cached: WIKI_SYSTEM_PROMPT,
    user: `Title: ${page.title}\nPath: ${page.path}\n\n${body}`,
    schema: SummarySchema,
    maxTokens: 512,
  });

  return result.value;
}

export interface SummarizeWikiOptions {
  contentDir: string;
  force?: boolean;
  noLlm?: boolean;
  completeFn?: typeof defaultComplete;
}

export interface SummarizeWikiResult {
  enriched: Record<string, Pick<PageRecord, 'summary' | 'keyFacts' | 'entities'>>;
  failures: string[];   // paths that failed
}

export async function summarizeWikiPages(
  pages: Record<string, PageRecord>,
  opts: SummarizeWikiOptions,
): Promise<SummarizeWikiResult> {
  const model = config().MODEL_EXTRACT;
  const failures: string[] = [];
  const enriched: SummarizeWikiResult['enriched'] = {};

  for (const [path, page] of Object.entries(pages)) {
    const needsSummary = opts.force || page.summary === null;
    if (!needsSummary || opts.noLlm) continue;

    try {
      const result = await summarizePage(page, opts.contentDir, { model, completeFn: opts.completeFn });
      enriched[path] = result;
    } catch (err) {
      console.error(`summarize failed for ${path}: ${(err as Error).message}`);
      failures.push(path);
    }
  }

  return { enriched, failures };
}
```

### Notes
- `--no-llm` is expressed as `opts.noLlm: true` — no pages are passed to `summarizePage`.
  The caller (Phase 3) merges `enriched` (which will be empty) back into the index and writes
  the carried-forward index. Existing summaries are preserved via `mergeIndex` in Phase 3.
- `PLACEHOLDER` is written for empty-body pages even on `--force`, because there's nothing to
  summarize.
- `stage: 'summarize'` and `page: page.path` feed the cost log for per-page cost tracking.

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` — no type errors
- [x] Unit tests (see Phase 4) cover: stub detection, schema validation, fake completeFn call

---

## Phase 3: CLI Integration

### Overview
`src/cli/index-wiki.ts` gains the full pipeline: parse → load on-disk → merge → summarize
missing → write atomically. `--no-llm` and `--force` flags added.

### Changes Required

#### `src/cli/index-wiki.ts`

```ts
import { loadWikiIndex, writeIndex, diffIndex, mergeIndex } from '../wiki/load';
import { summarizeWikiPages } from '../wiki/summarize';

const CONTENT_DIR = 'content';
const INDEX_PATH  = 'state/wiki-index.json';

export async function indexWiki(argv: string[]): Promise<void> {
  const check = argv.includes('--check');
  const noLlm = argv.includes('--no-llm');
  const force  = argv.includes('--force');

  const fresh = await loadWikiIndex({ contentDir: CONTENT_DIR });

  if (check) {
    const diff = await diffIndex(fresh, INDEX_PATH);
    if (!diff.stale) {
      console.log(`index up to date: ${fresh.pageCount} pages`);
      return;
    }
    console.error(
      `wiki index is stale: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
    );
    for (const p of diff.added)   console.error(`  + ${p}`);
    for (const p of diff.removed) console.error(`  - ${p}`);
    for (const p of diff.changed) console.error(`  ~ ${p}`);
    process.exit(1);
  }

  // Carry forward summaries for unchanged pages
  const onDiskFile = Bun.file(INDEX_PATH);
  let merged = fresh;
  if (!force && await onDiskFile.exists()) {
    const ondisk = JSON.parse(await onDiskFile.text());
    merged = mergeIndex(fresh, ondisk);
  }

  // Summarize pages that still have null summary
  const { enriched, failures } = await summarizeWikiPages(merged.pages, {
    contentDir: CONTENT_DIR,
    force,
    noLlm,
  });

  // Apply enriched results back into merged index
  for (const [path, result] of Object.entries(enriched)) {
    if (merged.pages[path]) {
      merged.pages[path] = { ...merged.pages[path]!, ...result };
    }
  }

  await writeIndex(merged, INDEX_PATH);

  const linkCount = Object.values(merged.pages).reduce((n, p) => n + p.wikilinks.length, 0);
  const summarized = Object.values(merged.pages).filter((p) => p.summary !== null).length;
  console.log(
    `wrote ${INDEX_PATH}: ${merged.pageCount} pages, ${summarized} summarized, ` +
    `${linkCount} wikilinks, ${merged.unresolvedLinks.length} unresolved`,
  );

  if (failures.length) {
    console.error(`${failures.length} page(s) failed to summarize:`);
    for (const f of failures) console.error(`  ! ${f}`);
    process.exit(1);
  }
}
```

### Success Criteria

#### Automated Verification
- [x] `bun run index-wiki` completes without error (integration: real LLM, real content)
- [x] Every page in index has non-null `summary` and `keyFacts` and `entities` after a full run
- [x] `bun run index-wiki` a second time with no content changes: run log shows 0 LLM calls
      (verify via `state/runs/` JSONL: no records with `stage: 'summarize'`)
- [x] Touch one content file, re-run, run log shows exactly 1 LLM call with that page's path
- [x] `bun run index-wiki --no-llm` never calls the LLM (injectFn mock in CLI test)
- [ ] `bun run index-wiki --force` re-summarizes all pages (all 93 log entries present)

#### Manual Verification
- [x] Record the total cost of one full re-index run; confirm within order of magnitude of ~$0.14
- [x] Spot-check 5 random summaries for accuracy and no hallucinations
- [x] Verify 3 stub pages have placeholder summary, not null

**Implementation Note**: After Phase 3 automated verification passes and you've done manual
spot-checking, confirm before moving to Phase 4 tests.

---

## Phase 4: Tests

### Overview
Unit tests for all pure logic; LLM-injected tests for summarize behavior; CLI flag tests.

### Changes Required

#### `src/wiki/summarize.test.ts` (new)

```ts
import { test, expect } from 'bun:test';
import { summarizePage, summarizeWikiPages, SummarizeResult } from './summarize';
import type { PageRecord } from './index-schema';
import * as path from 'node:path';

// Minimal page fixture factory
function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    path: 'Geography/Calaria/index.md',
    title: 'Calaria',
    aliases: [],
    tags: [],
    img: null,
    headings: [],
    wikilinks: [],
    contentHash: 'abc123',
    byteLength: 42,
    summary: null,
    keyFacts: null,
    entities: null,
    ...overrides,
  };
}

// Fake completeFn that returns a valid result
const FAKE_RESULT: SummarizeResult = {
  summary: 'A coastal city.',
  keyFacts: ['Has a harbor', 'Home to the Choral Order'],
  entities: { people: [], places: ['Harbor'], orgs: ['Choral Order'] },
};

const fakeFn = async (_args: any) => ({ text: '', usage: {} as any, value: FAKE_RESULT });

test('summarizePage returns placeholder for empty body', async () => {
  // content dir points to real content/ — use a known stub page
  const CONTENT_DIR = 'content';
  const stubPage = makePage({
    path: 'Phenomena/Stillness.md',
    title: 'Stillness',
    byteLength: 0,
  });
  const result = await summarizePage(stubPage, CONTENT_DIR, {
    model: 'claude-sonnet-4-6',
    completeFn: fakeFn,
  });
  expect(result.summary).toBe('(stub page — no content yet)');
  expect(result.keyFacts).toEqual([]);
});

test('summarizePage calls completeFn for non-empty page', async () => {
  const CONTENT_DIR = 'content';
  let called = false;
  const spy = async (args: any) => {
    called = true;
    expect(args.stage).toBe('summarize');
    expect(args.page).toBeTruthy();
    return { text: '', usage: {} as any, value: FAKE_RESULT };
  };
  const page = makePage({ path: 'Geography/Calaria/index.md', byteLength: 500 });
  await summarizePage(page, CONTENT_DIR, { model: 'claude-sonnet-4-6', completeFn: spy });
  expect(called).toBe(true);
});

test('summarizeWikiPages skips pages with non-null summary when not forced', async () => {
  let callCount = 0;
  const spy = async (_args: any) => { callCount++; return { text: '', usage: {} as any, value: FAKE_RESULT }; };
  const pages = {
    'a.md': makePage({ path: 'a.md', summary: 'already done' }),
    'b.md': makePage({ path: 'b.md', summary: null }),
  };
  await summarizeWikiPages(pages as any, {
    contentDir: 'content',
    completeFn: spy,
  });
  expect(callCount).toBeLessThanOrEqual(1); // only 'b.md' should be tried
});

test('summarizeWikiPages skips all when noLlm=true', async () => {
  let callCount = 0;
  const spy = async (_args: any) => { callCount++; return { text: '', usage: {} as any, value: FAKE_RESULT }; };
  const pages = {
    'a.md': makePage({ path: 'a.md', summary: null }),
    'b.md': makePage({ path: 'b.md', summary: null }),
  };
  await summarizeWikiPages(pages as any, {
    contentDir: 'content',
    noLlm: true,
    completeFn: spy,
  });
  expect(callCount).toBe(0);
});

test('summarizeWikiPages records failure and continues on error', async () => {
  let callCount = 0;
  const spy = async (_args: any) => {
    callCount++;
    if (callCount === 1) throw new Error('api flake');
    return { text: '', usage: {} as any, value: FAKE_RESULT };
  };
  const pages = {
    'a.md': makePage({ path: 'a.md', summary: null }),
    'b.md': makePage({ path: 'b.md', summary: null }),
  };
  const result = await summarizeWikiPages(pages as any, {
    contentDir: 'content',
    completeFn: spy,
  });
  expect(result.failures.length).toBe(1);
  expect(Object.keys(result.enriched).length).toBe(1);
});
```

#### `src/wiki/load.test.ts` additions

```ts
// Add to existing test file:
import { mergeIndex } from './load';

test('mergeIndex carries forward summary for unchanged pages', async () => {
  const fresh = await loadWikiIndex({ contentDir: CONTENT_DIR });
  // Manufacture fake on-disk index with summary on one page
  const [firstPath, firstPage] = Object.entries(fresh.pages)[0]!;
  const ondisk = {
    ...fresh,
    pages: {
      ...fresh.pages,
      [firstPath]: { ...firstPage, summary: 'test summary', keyFacts: ['fact1'], entities: { people: [], places: [], orgs: [] } },
    },
  };
  const merged = mergeIndex(fresh, ondisk);
  expect(merged.pages[firstPath]!.summary).toBe('test summary');
});

test('mergeIndex does not carry forward summary when contentHash differs', async () => {
  const fresh = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const [firstPath, firstPage] = Object.entries(fresh.pages)[0]!;
  const ondisk = {
    ...fresh,
    pages: {
      ...fresh.pages,
      [firstPath]: { ...firstPage, contentHash: 'different-hash', summary: 'stale summary' },
    },
  };
  const merged = mergeIndex(fresh, ondisk);
  expect(merged.pages[firstPath]!.summary).toBeNull();
});

test('existing test: contentHash, summary, keyFacts, and entities are null on fresh load', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const page of Object.values(index.pages)) {
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(page.byteLength).toBeGreaterThanOrEqual(0);
    expect(page.summary).toBeNull();
    expect(page.keyFacts).toBeNull();
    expect(page.entities).toBeNull();   // ← extend existing test
  }
});
```

### Success Criteria

#### Automated Verification
- [x] `bun test` — all tests pass (new + existing)
- [x] `bun run typecheck` — zero errors

#### Manual Verification
- [ ] n/a — all verification for this ticket is automated

---

## Testing Strategy

### What the Tests Cover
- Pure logic: `mergeIndex` carry-forward and hash-change detection
- Stub detection: empty-body pages return placeholder without calling LLM
- Error resilience: failures are collected and run continues
- Flag semantics: `--no-llm` makes zero LLM calls; `--force` re-summarizes all
- Schema: Zod validates length caps — violations throw before the result is written

### What's Explicitly NOT Tested
- Real Anthropic API calls (live tests in manual verification only)
- Atomic rename correctness (OS-level guarantee; trust `node:fs/promises rename`)

---

## Performance Considerations

- Full re-index ≈ $0.14 at 93 pages × Sonnet 4.6. Estimate may improve with prompt cache
  hits once the system prompt stabilizes across calls.
- Sequential processing: 93 pages × ~2s/call ≈ 3 min. Acceptable for an infrequent operation.
  Revisit if the wiki grows beyond ~500 pages.

---

## Migration Notes

No migration needed. The three new fields (`entities`, and the upgraded `writeIndex`) are fully
backwards-compatible: existing `state/wiki-index.json` entries without `entities` will be treated
as if `entities: null` by `mergeIndex` (since `stored.summary` will be null for those pages,
causing them to be re-summarized and the full schema populated).

---

## References

- Ticket: `tickets/004-wiki-page-summarization.md`
- Prior memory: `thoughts/shared/plans/2026-05-17-003-wiki-index-parse.md`
- Key files: `src/wiki/load.ts`, `src/wiki/index-schema.ts`, `src/llm.ts`, `src/log.ts`,
  `src/cli/index-wiki.ts`
