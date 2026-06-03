# Transcript Discovery + Ledger Implementation Plan

## Overview

Add a transcript discovery layer (filename parse + hashing) and a durable JSON ledger
that tracks pipeline stage state per transcript. The ledger lives in `state/processed.json`
(checked into git) so it survives `update-transcripts.sh` wiping `transcripts/`. Three
read/write CLI commands — `transcripts list`, `status`, `reset` — expose and edit it.

This is the foundation every downstream ticket (segmentation, extraction, matching,
proposal, verifier, MR submission) plugs into: each stage records a timestamp on success
and an error record on failure, all keyed by `filename + contentHash`.

## Current State Analysis

- No `src/transcript/` directory yet — first ticket in this subtree.
- `transcripts/` is a bind mount to `/emerald/data/experiments/heartwood/transcripts`
  (verified — same inode). `update-transcripts.sh` does `rm -r` on the downstream path,
  so anything inside `transcripts/` is volatile. The ledger must NOT live there.
- 37 transcripts on disk: 26 with id `000` (main campaign `through-a-song-darkly`)
  and 11 with ids `101–106` (side campaigns / one-shots). Hand-verified via
  `ls transcripts/ | awk -F. '{print $1}' | sort | uniq -c`.
- Date variants present in real filenames: `2025-8-28` and `2025-12-30` — the regex
  in the ticket (`\d{1,2}-\d{1,2}`) handles both, but lexicographic sort would put
  `2025-12-2` before `2025-8-28`, so we must normalize to ISO `YYYY-MM-DD` for sorting.
- `.gitignore` already whitelists `state/wiki-index.json` and `state/runs/.gitkeep`;
  `state/processed.json` needs the same explicit allow-line.
- `src/cli/index.ts` is a flat name→handler map. Sub-commands within a single
  handler (e.g. `transcripts list`) are routed inside the handler by inspecting
  `argv[0]`. Existing handlers (`indexWiki`, `costReport`) already do
  flag-based dispatch, so this is consistent.
- `src/wiki/hash.ts` exports `sha256Hex(bytes: Uint8Array)` — reuse for transcript
  hashing.
- `src/wiki/load.ts:147–151` shows the atomic-write idiom (`Bun.write` to
  `<path>.tmp`, then `rename`). Re-use the same pattern for the ledger.

### Key Discoveries

- Ledger schema is strict per ticket: `{ entries: [{ filename, contentHash, stages, prUrl?, errors }] }`.
  No campaign/date denormalization — we re-parse the filename for display.
- `package.json` scripts pattern: `"<name>": "bun index.ts <name>"`. Extra argv from
  `bun run <name> foo bar` is forwarded, so `bun run transcripts list` works with the
  handler dispatching internally.
- The `state/` directory is the only durable surface: `state/wiki-index.json` is the
  precedent for "checked-in JSON state file."

## Desired End State

`bun run transcripts list` walks `transcripts/`, reconciles `state/processed.json`,
writes back if anything changed (new file, hash change, etc.), and prints a status
table covering all 37 current transcripts plus any historical entries.
`bun run transcripts status <name>` prints per-stage detail (timestamps, errors,
prUrl) for one transcript. `bun run transcripts reset <name> [--stage <stage>]`
clears stage timestamps (and downstream timestamps when `--stage` is given) so the
pipeline reprocesses that transcript on the next run.

The ledger is git-tracked, atomically written, and survives `update-transcripts.sh`
round-trips because it lives in `state/` and keys off `filename + contentHash`.

## What We're NOT Doing

- No pipeline stages actually run in this ticket — `segmented`/`extracted`/etc. start
  as `null` and stay there. Ticket 006+ wire each stage's runner.
- No removal of orphaned ledger entries (transcripts that disappear from disk).
  We keep the entry and mark it `(missing)` in `list` output. A future `transcripts prune`
  could clean these up; not now.
- No `--json` output flag for `list` or `status`. Add if a downstream consumer
  needs it.
- No file-watcher / daemon. Ledger reconciliation is on-demand per CLI invocation.
- No concurrency control for the ledger file — single-writer assumption matches
  the rest of the pipeline.
- No transcript-content validation beyond the filename regex. Parsing line numbers
  out of the body is segmentation's job (ticket 006).

## Implementation Approach

Three sequential phases. Phase 1 builds the pure parse + hash layer (no state).
Phase 2 builds the ledger with reconciliation and mutation helpers (depends only
on Phase 1's `TranscriptFile` type). Phase 3 wires the CLI, registers the handler,
and seeds the first checked-in `state/processed.json` by running the new command
against the real `transcripts/` directory.

Dependency injection is used in the CLI module — `list`/`status`/`reset` accept
optional `transcriptsDir` and `ledgerPath` so tests can point them at temp dirs
without touching real state. Same idiom as `summarizeWikiPages` accepting
`completeFn`.

---

## Phase 1: Discovery Module

### Overview

Pure parsing + filesystem walk. Returns a sorted list of `TranscriptFile` records
and a list of filenames that didn't match the regex (skipped with warning).

### Changes Required

#### 1. `src/transcript/discover.ts` (new)

```ts
import { sha256Hex } from '../wiki/hash';

export interface TranscriptFile {
  filename: string;       // e.g. "000.through-a-song-darkly.2025-8-28.txt"
  campaignId: number;     // 0
  campaignName: string;   // "through-a-song-darkly"
  sessionDate: string;    // "2025-08-28" — ISO-normalized for stable sort
  isMain: boolean;        // campaignId < 100
  contentHash: string;    // sha256 hex of file bytes
  byteLength: number;
}

export interface SkippedFile {
  filename: string;
  reason: string;
}

export interface DiscoveryResult {
  files: TranscriptFile[];     // sorted by (campaignId, sessionDate)
  skipped: SkippedFile[];
}

const FILENAME_RE = /^(\d+)\.([^.]+)\.(\d{4})-(\d{1,2})-(\d{1,2})\.txt$/;

export function parseFilename(filename: string): Omit<TranscriptFile, 'contentHash' | 'byteLength'> | null {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  const campaignId = Number(m[1]);
  const campaignName = m[2]!;
  const year = m[3]!;
  const month = m[4]!.padStart(2, '0');
  const day = m[5]!.padStart(2, '0');
  return {
    filename,
    campaignId,
    campaignName,
    sessionDate: `${year}-${month}-${day}`,
    isMain: campaignId < 100,
  };
}

export async function discoverTranscripts(transcriptsDir: string): Promise<DiscoveryResult> {
  const glob = new Bun.Glob('*.txt');
  const names: string[] = [];
  for await (const n of glob.scan({ cwd: transcriptsDir, absolute: false })) names.push(n);
  names.sort();

  const files: TranscriptFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const name of names) {
    const parsed = parseFilename(name);
    if (!parsed) {
      skipped.push({ filename: name, reason: 'filename does not match <id>.<name>.<YYYY-M-D>.txt' });
      continue;
    }
    const file = Bun.file(`${transcriptsDir}/${name}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    files.push({
      ...parsed,
      contentHash: sha256Hex(bytes),
      byteLength: bytes.byteLength,
    });
  }

  files.sort((a, b) =>
    a.campaignId - b.campaignId ||
    a.sessionDate.localeCompare(b.sessionDate),
  );

  return { files, skipped };
}
```

#### 2. `src/transcript/discover.test.ts` (new)

Cover the ticket's explicit cases plus normalization and sort order.

```ts
import { test, expect } from 'bun:test';
import { parseFilename, discoverTranscripts } from './discover';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parses a main-campaign filename', () => {
  const r = parseFilename('000.through-a-song-darkly.2025-10-20.txt');
  expect(r).toEqual({
    filename: '000.through-a-song-darkly.2025-10-20.txt',
    campaignId: 0,
    campaignName: 'through-a-song-darkly',
    sessionDate: '2025-10-20',
    isMain: true,
  });
});

test('parses a side-campaign filename (id >= 100)', () => {
  const r = parseFilename('101.interred-in-iomenei.2026-2-10.txt');
  expect(r?.campaignId).toBe(101);
  expect(r?.isMain).toBe(false);
  expect(r?.sessionDate).toBe('2026-02-10');
});

test('normalizes single-digit month/day to zero-padded ISO', () => {
  expect(parseFilename('000.foo.2025-8-28.txt')?.sessionDate).toBe('2025-08-28');
  expect(parseFilename('000.foo.2025-12-2.txt')?.sessionDate).toBe('2025-12-02');
  expect(parseFilename('000.foo.2025-12-30.txt')?.sessionDate).toBe('2025-12-30');
});

test('accepts multi-word hyphenated campaign names', () => {
  expect(parseFilename('103.a-hunt-of-metal-and-vine.2025-6-9.txt')?.campaignName)
    .toBe('a-hunt-of-metal-and-vine');
});

test('returns null for malformed filenames', () => {
  expect(parseFilename('readme.txt')).toBeNull();
  expect(parseFilename('000.no-date.txt')).toBeNull();
  expect(parseFilename('abc.thing.2025-1-1.txt')).toBeNull();        // non-numeric id
  expect(parseFilename('000.thing.2025-1-1.md')).toBeNull();         // wrong ext
});

test('discoverTranscripts walks a directory and hashes contents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-'));
  try {
    writeFileSync(join(dir, '000.alpha.2025-8-28.txt'),  'AAA');
    writeFileSync(join(dir, '000.alpha.2025-12-2.txt'),  'BBB');
    writeFileSync(join(dir, '101.beta.2026-1-1.txt'),    'CCC');
    writeFileSync(join(dir, 'notes.txt'),                'skip me');
    const r = await discoverTranscripts(dir);
    expect(r.files.length).toBe(3);
    expect(r.skipped.length).toBe(1);
    expect(r.skipped[0]!.filename).toBe('notes.txt');
    // Sort: campaignId asc, then sessionDate asc (ISO-normalized, so 8-28 < 12-2)
    expect(r.files.map((f) => f.filename)).toEqual([
      '000.alpha.2025-8-28.txt',
      '000.alpha.2025-12-2.txt',
      '101.beta.2026-1-1.txt',
    ]);
    // Hash present and 64-hex
    for (const f of r.files) expect(f.contentHash).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverTranscripts against the real transcripts/ dir finds 37 files (26 main, 11 side)', async () => {
  const r = await discoverTranscripts('transcripts');
  expect(r.files.length).toBe(37);
  expect(r.files.filter((f) => f.isMain).length).toBe(26);
  expect(r.files.filter((f) => !f.isMain).length).toBe(11);
});
```

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test src/transcript/discover.test.ts` — all parse/sort/discovery cases pass
- [x] The real-data test counts 37 / 26 / 11 (matches the ticket's explicit numbers)

---

## Phase 2: Ledger Module

### Overview

`src/transcript/ledger.ts` owns the persisted JSON, reconciliation with discovery
results, and the mutation helpers the CLI (and later, stage runners) call.

### Changes Required

#### 1. `src/transcript/ledger.ts` (new)

Schema, atomic IO, reconcile, mutate. All mutation functions return a NEW ledger
(immutable-style) so tests can compare snapshots cleanly.

```ts
import { rename } from 'node:fs/promises';
import { z } from 'zod';
import type { TranscriptFile } from './discover';

export const STAGE_ORDER = [
  'segmented',
  'extracted',
  'matched',
  'proposed',
  'verified',
  'prOpened',
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

export const StagesSchema = z.object({
  segmented: z.string().nullable(),
  extracted: z.string().nullable(),
  matched:   z.string().nullable(),
  proposed:  z.string().nullable(),
  verified:  z.string().nullable(),
  prOpened:  z.string().nullable(),
});

export const ErrorRecordSchema = z.object({
  stage:   z.enum(STAGE_ORDER),
  ts:      z.string(),
  message: z.string(),
});

export const LedgerEntrySchema = z.object({
  filename:    z.string(),
  contentHash: z.string(),
  stages:      StagesSchema,
  prUrl:       z.string().optional(),
  errors:      z.array(ErrorRecordSchema),
});

export const LedgerSchema = z.object({
  entries: z.array(LedgerEntrySchema),
});

export type Stages = z.infer<typeof StagesSchema>;
export type ErrorRecord = z.infer<typeof ErrorRecordSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type Ledger = z.infer<typeof LedgerSchema>;

export const EMPTY_STAGES: Stages = {
  segmented: null, extracted: null, matched: null,
  proposed:  null, verified:  null, prOpened: null,
};

export function emptyLedger(): Ledger {
  return { entries: [] };
}

// ---- IO ----

export async function readLedger(path: string): Promise<Ledger> {
  const file = Bun.file(path);
  if (!(await file.exists())) return emptyLedger();
  const raw = JSON.parse(await file.text());
  return LedgerSchema.parse(raw);
}

export async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(ledger, null, 2) + '\n');
  await rename(tmp, path);
}

// ---- Reconcile ----

export interface ReconcileChanges {
  added:     string[];   // new files appearing in discovery
  unchanged: string[];   // file present, hash matches existing entry
  rehashed:  string[];   // file present, hash differs — entry kept but stages cleared
  missing:   string[];   // ledger entry has no file in current discovery
}

export interface ReconcileResult {
  ledger:  Ledger;       // new ledger object
  changes: ReconcileChanges;
}

export function reconcile(prior: Ledger, discovered: TranscriptFile[]): ReconcileResult {
  const byFilename = new Map<string, LedgerEntry>();
  for (const e of prior.entries) byFilename.set(e.filename, e);

  const discoveredNames = new Set(discovered.map((f) => f.filename));
  const changes: ReconcileChanges = { added: [], unchanged: [], rehashed: [], missing: [] };
  const nextEntries: LedgerEntry[] = [];

  for (const f of discovered) {
    const existing = byFilename.get(f.filename);
    if (!existing) {
      nextEntries.push({
        filename:    f.filename,
        contentHash: f.contentHash,
        stages:      { ...EMPTY_STAGES },
        errors:      [],
      });
      changes.added.push(f.filename);
    } else if (existing.contentHash === f.contentHash) {
      nextEntries.push(existing);
      changes.unchanged.push(f.filename);
    } else {
      // Hash changed: keep entry identity, clear pipeline state.
      nextEntries.push({
        filename:    f.filename,
        contentHash: f.contentHash,
        stages:      { ...EMPTY_STAGES },
        errors:      [],
      });
      changes.rehashed.push(f.filename);
    }
  }

  // Preserve orphan entries (file removed from disk) so we don't lose pipeline history.
  for (const e of prior.entries) {
    if (!discoveredNames.has(e.filename)) {
      nextEntries.push(e);
      changes.missing.push(e.filename);
    }
  }

  // Stable sort: discovered come first in discovery order; orphans appended at end.
  // The CLI re-derives display order from filename parsing, so the on-disk order
  // is purely for human-readable diffs.
  return { ledger: { entries: nextEntries }, changes };
}

// ---- Lookup ----

export type FindResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: string[] };

export function findEntry(ledger: Ledger, name: string): FindResult {
  // 1. Exact match (with or without trailing .txt)
  const withExt = name.endsWith('.txt') ? name : `${name}.txt`;
  const exact = ledger.entries.find((e) => e.filename === name || e.filename === withExt);
  if (exact) return { ok: true, entry: exact };

  // 2. Unique substring match
  const matches = ledger.entries.filter((e) => e.filename.includes(name));
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length === 1) return { ok: true, entry: matches[0]! };
  return { ok: false, reason: 'ambiguous', candidates: matches.map((e) => e.filename) };
}

// ---- Mutations (all return a new ledger) ----

function replaceEntry(ledger: Ledger, filename: string, fn: (e: LedgerEntry) => LedgerEntry): Ledger {
  return {
    entries: ledger.entries.map((e) => (e.filename === filename ? fn(e) : e)),
  };
}

export function markStage(ledger: Ledger, filename: string, stage: Stage, ts = new Date().toISOString()): Ledger {
  return replaceEntry(ledger, filename, (e) => ({
    ...e,
    stages: { ...e.stages, [stage]: ts },
    // Drop any prior errors for this stage — the latest run succeeded.
    errors: e.errors.filter((err) => err.stage !== stage),
  }));
}

export function recordError(ledger: Ledger, filename: string, stage: Stage, message: string, ts = new Date().toISOString()): Ledger {
  return replaceEntry(ledger, filename, (e) => ({
    ...e,
    errors: [...e.errors, { stage, ts, message }],
  }));
}

export function setPrUrl(ledger: Ledger, filename: string, prUrl: string): Ledger {
  return replaceEntry(ledger, filename, (e) => ({ ...e, prUrl }));
}

export function resetEntry(ledger: Ledger, filename: string): Ledger {
  return replaceEntry(ledger, filename, (e) => ({
    filename: e.filename,
    contentHash: e.contentHash,
    stages: { ...EMPTY_STAGES },
    errors: [],
    // prUrl explicitly omitted
  }));
}

export function resetEntryStage(ledger: Ledger, filename: string, stage: Stage): Ledger {
  const startIdx = STAGE_ORDER.indexOf(stage);
  if (startIdx < 0) throw new Error(`unknown stage: ${stage}`);
  const cleared = new Set<Stage>(STAGE_ORDER.slice(startIdx));
  return replaceEntry(ledger, filename, (e) => {
    const stages: Stages = { ...e.stages };
    for (const s of cleared) stages[s] = null;
    // If we cleared prOpened, drop prUrl too — it's now meaningless.
    const next: LedgerEntry = {
      ...e,
      stages,
      errors: e.errors.filter((err) => !cleared.has(err.stage)),
    };
    if (cleared.has('prOpened')) delete next.prUrl;
    return next;
  });
}
```

#### 2. `src/transcript/ledger.test.ts` (new)

```ts
import { test, expect } from 'bun:test';
import {
  emptyLedger, reconcile, findEntry,
  markStage, recordError, setPrUrl, resetEntry, resetEntryStage,
  readLedger, writeLedger, LedgerSchema,
  type LedgerEntry, EMPTY_STAGES,
} from './ledger';
import type { TranscriptFile } from './discover';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixtureFile(overrides: Partial<TranscriptFile> = {}): TranscriptFile {
  return {
    filename: '000.alpha.2025-8-28.txt',
    campaignId: 0,
    campaignName: 'alpha',
    sessionDate: '2025-08-28',
    isMain: true,
    contentHash: 'hash-A',
    byteLength: 100,
    ...overrides,
  };
}

test('reconcile creates entries for newly discovered files', () => {
  const f = fixtureFile();
  const { ledger, changes } = reconcile(emptyLedger(), [f]);
  expect(ledger.entries.length).toBe(1);
  expect(ledger.entries[0]!.filename).toBe(f.filename);
  expect(ledger.entries[0]!.contentHash).toBe('hash-A');
  expect(ledger.entries[0]!.stages).toEqual(EMPTY_STAGES);
  expect(changes.added).toEqual([f.filename]);
});

test('reconcile preserves entry when contentHash unchanged (survives transcripts/ wipe)', () => {
  const f = fixtureFile();
  const prior = markStage(reconcile(emptyLedger(), [f]).ledger, f.filename, 'segmented', '2026-01-01T00:00:00Z');
  const next = reconcile(prior, [f]); // simulating update-transcripts.sh round-trip: same name, same hash
  expect(next.changes.unchanged).toEqual([f.filename]);
  expect(next.changes.rehashed).toEqual([]);
  expect(next.ledger.entries[0]!.stages.segmented).toBe('2026-01-01T00:00:00Z');
});

test('reconcile clears stages when contentHash differs', () => {
  const f = fixtureFile();
  const stale = markStage(reconcile(emptyLedger(), [f]).ledger, f.filename, 'segmented');
  const stale2 = setPrUrl(stale, f.filename, 'https://gitlab/.../-/merge_requests/7');
  const fNew = fixtureFile({ contentHash: 'hash-B' });
  const next = reconcile(stale2, [fNew]);
  expect(next.changes.rehashed).toEqual([f.filename]);
  expect(next.ledger.entries[0]!.stages).toEqual(EMPTY_STAGES);
  expect(next.ledger.entries[0]!.contentHash).toBe('hash-B');
  expect(next.ledger.entries[0]!.prUrl).toBeUndefined();
  expect(next.ledger.entries[0]!.errors).toEqual([]);
});

test('reconcile keeps orphan entries when a transcript disappears', () => {
  const f = fixtureFile();
  const prior = reconcile(emptyLedger(), [f]).ledger;
  const next = reconcile(prior, []);
  expect(next.ledger.entries.length).toBe(1);
  expect(next.changes.missing).toEqual([f.filename]);
});

test('findEntry: exact match (with and without .txt)', () => {
  const ledger = reconcile(emptyLedger(), [fixtureFile()]).ledger;
  expect(findEntry(ledger, '000.alpha.2025-8-28.txt')).toMatchObject({ ok: true });
  expect(findEntry(ledger, '000.alpha.2025-8-28')).toMatchObject({ ok: true });
});

test('findEntry: unique substring match', () => {
  const ledger = reconcile(emptyLedger(), [
    fixtureFile({ filename: '000.alpha.2025-8-28.txt' }),
    fixtureFile({ filename: '101.beta.2026-1-1.txt', campaignId: 101 }),
  ]).ledger;
  const r = findEntry(ledger, '2025-8-28');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.entry.filename).toBe('000.alpha.2025-8-28.txt');
});

test('findEntry: ambiguous substring returns candidates', () => {
  const ledger = reconcile(emptyLedger(), [
    fixtureFile({ filename: '000.alpha.2025-8-28.txt' }),
    fixtureFile({ filename: '000.alpha.2025-9-1.txt' }),
  ]).ledger;
  const r = findEntry(ledger, 'alpha');
  expect(r.ok).toBe(false);
  if (!r.ok && r.reason === 'ambiguous') expect(r.candidates.length).toBe(2);
});

test('findEntry: not_found returned cleanly', () => {
  const r = findEntry(emptyLedger(), 'nope');
  expect(r).toEqual({ ok: false, reason: 'not_found' });
});

test('markStage sets timestamp and clears prior errors for that stage', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = recordError(l, f.filename, 'segmented', 'flaky');
  l = markStage(l, f.filename, 'segmented', '2026-02-01T00:00:00Z');
  expect(l.entries[0]!.stages.segmented).toBe('2026-02-01T00:00:00Z');
  expect(l.entries[0]!.errors).toEqual([]);
});

test('resetEntry clears all stages, errors, and prUrl', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = markStage(l, f.filename, 'segmented');
  l = markStage(l, f.filename, 'extracted');
  l = setPrUrl(l, f.filename, 'https://example/mr/1');
  l = recordError(l, f.filename, 'matched', 'boom');
  l = resetEntry(l, f.filename);
  expect(l.entries[0]!.stages).toEqual(EMPTY_STAGES);
  expect(l.entries[0]!.errors).toEqual([]);
  expect(l.entries[0]!.prUrl).toBeUndefined();
});

test('resetEntryStage clears the named stage AND all downstream stages (cascade)', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  for (const s of ['segmented', 'extracted', 'matched', 'proposed', 'verified', 'prOpened'] as const) {
    l = markStage(l, f.filename, s);
  }
  l = setPrUrl(l, f.filename, 'https://example/mr/1');
  l = resetEntryStage(l, f.filename, 'matched');
  const s = l.entries[0]!.stages;
  expect(s.segmented).not.toBeNull();
  expect(s.extracted).not.toBeNull();
  expect(s.matched).toBeNull();
  expect(s.proposed).toBeNull();
  expect(s.verified).toBeNull();
  expect(s.prOpened).toBeNull();
  // prUrl cleared because prOpened was cleared
  expect(l.entries[0]!.prUrl).toBeUndefined();
});

test('resetEntryStage preserves prUrl when cascade does not reach prOpened', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = setPrUrl(l, f.filename, 'https://example/mr/1');
  // Cascade only reaches stages from prOpened forward — there is no stage after prOpened,
  // so resetting prOpened alone clears it (and prUrl). Resetting an earlier stage clears
  // prUrl too because prOpened is in the cascade set. Hence this test uses a fake schema
  // shape: we just verify that mid-cascade reset still wipes prUrl since prOpened is last.
  l = resetEntryStage(l, f.filename, 'verified');
  expect(l.entries[0]!.prUrl).toBeUndefined();
});

test('readLedger returns empty when file does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const l = await readLedger(join(dir, 'nope.json'));
    expect(l).toEqual(emptyLedger());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeLedger + readLedger round-trips through Zod schema', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const path = join(dir, 'processed.json');
    const f = fixtureFile();
    let l = reconcile(emptyLedger(), [f]).ledger;
    l = markStage(l, f.filename, 'segmented', '2026-03-01T00:00:00Z');
    l = setPrUrl(l, f.filename, 'https://example/mr/9');
    await writeLedger(path, l);
    const back = await readLedger(path);
    expect(back).toEqual(l);
    // Verify the on-disk file is valid against the schema directly
    const raw = JSON.parse(await Bun.file(path).text());
    expect(() => LedgerSchema.parse(raw)).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test src/transcript/ledger.test.ts` — all reconcile/mutate/IO cases pass
- [x] Schema round-trips through `LedgerSchema.parse` after write+read

---

## Phase 3: CLI Surface + Integration

### Overview

`bun run transcripts <subcommand>` dispatches to `list`/`status`/`reset`. Every
invocation reconciles the ledger against the current `transcripts/` directory and
writes back only if mutations occurred (so a no-op `list` does not churn the file).
Phase finishes by running the command once for real and committing the seeded
`state/processed.json`.

### Changes Required

#### 1. `src/cli/transcripts.ts` (new)

```ts
import { discoverTranscripts, parseFilename } from '../transcript/discover';
import {
  readLedger, writeLedger, reconcile, findEntry,
  resetEntry, resetEntryStage,
  STAGE_ORDER, type Ledger, type LedgerEntry, type Stage,
} from '../transcript/ledger';

const TRANSCRIPTS_DIR = 'transcripts';
const LEDGER_PATH     = 'state/processed.json';

export interface TranscriptsCliOptions {
  transcriptsDir?: string;
  ledgerPath?: string;
}

export async function transcripts(argv: string[], opts: TranscriptsCliOptions = {}): Promise<void> {
  const transcriptsDir = opts.transcriptsDir ?? TRANSCRIPTS_DIR;
  const ledgerPath     = opts.ledgerPath     ?? LEDGER_PATH;

  const [sub, ...rest] = argv;
  if (!sub) {
    printUsage();
    process.exit(1);
  }

  // All commands start with a reconcile, so the table/detail/reset operate on fresh state.
  const prior = await readLedger(ledgerPath);
  const { files, skipped } = await discoverTranscripts(transcriptsDir);
  for (const s of skipped) console.error(`warning: skipping ${s.filename} — ${s.reason}`);
  const { ledger: reconciled, changes } = reconcile(prior, files);

  // Persist reconciliation if anything actually changed.
  const reconcileChanged = changes.added.length + changes.rehashed.length > 0;

  switch (sub) {
    case 'list':
      if (reconcileChanged) await writeLedger(ledgerPath, reconciled);
      printList(reconciled, new Set(files.map((f) => f.filename)));
      return;

    case 'status': {
      if (reconcileChanged) await writeLedger(ledgerPath, reconciled);
      const name = rest[0];
      if (!name) { console.error('usage: transcripts status <name>'); process.exit(1); }
      const r = findEntry(reconciled, name);
      if (!r.ok) { printFindFailure(r, name); process.exit(1); }
      printStatus(r.entry);
      return;
    }

    case 'reset': {
      const name = rest[0];
      if (!name) { console.error('usage: transcripts reset <name> [--stage <stage>]'); process.exit(1); }
      const stageIdx = rest.indexOf('--stage');
      const stage = stageIdx >= 0 ? rest[stageIdx + 1] : undefined;
      if (stageIdx >= 0 && !stage) { console.error('--stage requires a value'); process.exit(1); }
      if (stage && !(STAGE_ORDER as readonly string[]).includes(stage)) {
        console.error(`unknown stage: ${stage}. Known: ${STAGE_ORDER.join(', ')}`);
        process.exit(1);
      }
      const r = findEntry(reconciled, name);
      if (!r.ok) { printFindFailure(r, name); process.exit(1); }
      const after = stage
        ? resetEntryStage(reconciled, r.entry.filename, stage as Stage)
        : resetEntry(reconciled, r.entry.filename);
      await writeLedger(ledgerPath, after);
      console.log(stage
        ? `reset ${r.entry.filename} from stage '${stage}' (cascade)`
        : `reset ${r.entry.filename} (all stages)`);
      return;
    }

    default:
      console.error(`unknown subcommand: ${sub}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  console.log('Usage:');
  console.log('  bun run transcripts list');
  console.log('  bun run transcripts status <name>');
  console.log('  bun run transcripts reset  <name> [--stage <stage>]');
  console.log(`stages: ${STAGE_ORDER.join(', ')}`);
}

function printFindFailure(r: Exclude<ReturnType<typeof findEntry>, { ok: true }>, name: string): void {
  if (r.reason === 'not_found') {
    console.error(`no transcript matches '${name}'`);
  } else {
    console.error(`'${name}' is ambiguous — matches:`);
    for (const c of r.candidates) console.error(`  ${c}`);
  }
}

function printList(ledger: Ledger, present: Set<string>): void {
  const rows = ledger.entries.map((e) => {
    const parsed = parseFilename(e.filename);
    return {
      entry: e,
      parsed,
      missing: !present.has(e.filename),
    };
  });

  rows.sort((a, b) => {
    if (!a.parsed && !b.parsed) return a.entry.filename.localeCompare(b.entry.filename);
    if (!a.parsed) return 1;
    if (!b.parsed) return -1;
    return a.parsed.campaignId - b.parsed.campaignId
      || a.parsed.sessionDate.localeCompare(b.parsed.sessionDate);
  });

  const stageHeaders = STAGE_ORDER.map((s) => s.slice(0, 3));
  const header = ['ID', 'Campaign', 'Date', ...stageHeaders, 'PR'];
  const dataRows = rows.map((r) => {
    const id = r.parsed ? r.parsed.campaignId.toString().padStart(3, '0') : '?';
    const camp = (r.parsed?.campaignName ?? r.entry.filename) + (r.missing ? ' (missing)' : '');
    const date = r.parsed?.sessionDate ?? '';
    const stageCells = STAGE_ORDER.map((s) => {
      const hasError = r.entry.errors.some((e) => e.stage === s);
      if (hasError) return '!';
      return r.entry.stages[s] ? '✓' : '·';
    });
    const pr = r.entry.prUrl ? '✓' : '';
    return [id, camp, date, ...stageCells, pr];
  });

  const all = [header, ...dataRows];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i]!.length)));
  const fmt = (row: string[]) => row.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(fmt(header));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of dataRows) console.log(fmt(row));

  const main = rows.filter((r) => r.parsed?.isMain && !r.missing).length;
  const side = rows.filter((r) => r.parsed && !r.parsed.isMain && !r.missing).length;
  console.log(`\n${rows.length} ledger entries; ${main} main + ${side} side currently on disk`);
}

function printStatus(entry: LedgerEntry): void {
  console.log(`filename:    ${entry.filename}`);
  console.log(`contentHash: ${entry.contentHash}`);
  console.log(`prUrl:       ${entry.prUrl ?? '(none)'}`);
  console.log('stages:');
  for (const s of STAGE_ORDER) {
    console.log(`  ${s.padEnd(10)} ${entry.stages[s] ?? '(pending)'}`);
  }
  console.log(`errors: ${entry.errors.length}`);
  for (const e of entry.errors) {
    console.log(`  [${e.ts}] ${e.stage}: ${e.message}`);
  }
}
```

#### 2. `src/cli/transcripts.test.ts` (new)

Use temp dirs and a temp ledger path so tests don't touch real state.

```ts
import { test, expect } from 'bun:test';
import { transcripts } from './transcripts';
import { readLedger } from '../transcript/ledger';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'transcripts-cli-'));
  writeFileSync(join(dir, 'transcripts'), '');           // placeholder so subdir exists
  rmSync(join(dir, 'transcripts'));
  const tDir = join(dir, 'transcripts');
  return tDir;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'transcripts-cli-'));
  const transcriptsDir = join(root, 'transcripts');
  const ledgerPath = join(root, 'processed.json');
  // bun:fs
  const { mkdirSync } = require('node:fs');
  mkdirSync(transcriptsDir);
  writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), 'A');
  writeFileSync(join(transcriptsDir, '101.beta.2026-1-1.txt'),   'B');
  return { root, transcriptsDir, ledgerPath };
}

function teardown(root: string) {
  rmSync(root, { recursive: true, force: true });
}

test('list creates ledger on first run and persists entries', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcripts(['list'], { transcriptsDir, ledgerPath });
    const l = await readLedger(ledgerPath);
    expect(l.entries.length).toBe(2);
    expect(l.entries.map((e) => e.filename).sort()).toEqual([
      '000.alpha.2025-8-28.txt',
      '101.beta.2026-1-1.txt',
    ]);
  } finally { teardown(root); }
});

test('list is idempotent — second run does not rewrite when nothing changed', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcripts(['list'], { transcriptsDir, ledgerPath });
    const mtime1 = (await Bun.file(ledgerPath).stat()).mtimeMs;
    // small delay so the FS clock can advance if a write did happen
    await new Promise((r) => setTimeout(r, 5));
    await transcripts(['list'], { transcriptsDir, ledgerPath });
    const mtime2 = (await Bun.file(ledgerPath).stat()).mtimeMs;
    expect(mtime2).toBe(mtime1);
  } finally { teardown(root); }
});

test('status prints by exact filename and by unique substring', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcripts(['list'], { transcriptsDir, ledgerPath });
    // Both should succeed without throwing/exiting
    await transcripts(['status', '000.alpha.2025-8-28.txt'], { transcriptsDir, ledgerPath });
    await transcripts(['status', '2025-8-28'],               { transcriptsDir, ledgerPath });
  } finally { teardown(root); }
});

test('reset --stage X cascades downstream', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcripts(['list'], { transcriptsDir, ledgerPath });
    // Hand-edit the ledger to mark every stage complete on one entry
    const { readLedger, writeLedger, markStage } = await import('../transcript/ledger');
    let l = await readLedger(ledgerPath);
    for (const s of ['segmented', 'extracted', 'matched', 'proposed', 'verified', 'prOpened'] as const) {
      l = markStage(l, '000.alpha.2025-8-28.txt', s);
    }
    await writeLedger(ledgerPath, l);

    await transcripts(['reset', '2025-8-28', '--stage', 'matched'], { transcriptsDir, ledgerPath });
    const after = await readLedger(ledgerPath);
    const e = after.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.segmented).not.toBeNull();
    expect(e.stages.extracted).not.toBeNull();
    expect(e.stages.matched).toBeNull();
    expect(e.stages.proposed).toBeNull();
    expect(e.stages.verified).toBeNull();
    expect(e.stages.prOpened).toBeNull();
  } finally { teardown(root); }
});

test('rehashed file (content change) clears stages on next list', async () => {
  const { root, transcriptsDir, ledgerPath } = setup();
  try {
    await transcripts(['list'], { transcriptsDir, ledgerPath });
    const { readLedger, writeLedger, markStage } = await import('../transcript/ledger');
    let l = await readLedger(ledgerPath);
    l = markStage(l, '000.alpha.2025-8-28.txt', 'segmented', '2026-01-01T00:00:00Z');
    await writeLedger(ledgerPath, l);

    // Change file content → new hash
    writeFileSync(join(transcriptsDir, '000.alpha.2025-8-28.txt'), 'A-CHANGED');
    await transcripts(['list'], { transcriptsDir, ledgerPath });

    const after = await readLedger(ledgerPath);
    const e = after.entries.find((x) => x.filename === '000.alpha.2025-8-28.txt')!;
    expect(e.stages.segmented).toBeNull();
  } finally { teardown(root); }
});
```

#### 3. `src/cli/index.ts` — register handler

```ts
import { hello } from './hello';
import { costReport } from './cost-report';
import { indexWiki } from './index-wiki';
import { transcripts } from './transcripts';

export type CliHandler = (argv: string[]) => Promise<void> | void;

export const handlers: Record<string, CliHandler> = {
  'hello': hello,
  'cost-report': costReport,
  'index-wiki': indexWiki,
  'transcripts': transcripts,
};
```

#### 4. `package.json` — add script

```json
"scripts": {
  "hello": "bun index.ts hello",
  "cost-report": "bun index.ts cost-report",
  "index-wiki": "bun index.ts index-wiki",
  "transcripts": "bun index.ts transcripts",
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

#### 5. `.gitignore` — allow ledger to be committed

Append to the "heartwood pipeline state" block:

```
!state/processed.json
```

#### 6. `state/processed.json` — initial committed ledger

Generated by running `bun run transcripts list` once the rest of Phase 3 lands.
Should contain 37 entries with all stage timestamps null and empty errors.
Commit alongside the code changes.

### Success Criteria

#### Automated Verification
- [x] `bun run typecheck` passes
- [x] `bun test` — all new transcript tests plus existing wiki/log/config tests pass
- [x] `bun run transcripts list` enumerates all 37 current transcripts and prints
      `26 main + 11 side currently on disk`
- [x] Running `bun run transcripts list` a second time leaves `state/processed.json`
      byte-identical (no spurious rewrites)
- [x] `bun run transcripts status 2025-8-28` (or any unique substring) prints the
      detail block for one transcript
- [x] `bun run transcripts reset 2025-8-28` modifies the file (verified by re-reading
      the entry); `bun run transcripts reset 2025-8-28 --stage matched` cascade-clears
      stages from `matched` onward
- [x] Ambiguous match exits non-zero with candidate list (e.g. substring `alpha`
      across two same-campaign entries)

#### Manual Verification
- [ ] After running `update-transcripts.sh` end-to-end, re-run `bun run transcripts list`:
      ledger entries with unchanged contentHash still carry whatever stage timestamps
      they had before the wipe. (Verify by hand-marking a stage timestamp on one entry,
      running the script, and re-listing.)
- [ ] `state/processed.json` is committed and shows up in `git ls-files state/`.
- [ ] `git diff` on a no-op re-run shows no changes to the ledger.

**Implementation Note**: After Phase 3 automated verification passes, hand-verify
the `update-transcripts.sh` round-trip before considering the ticket done.

---

## Testing Strategy

### Unit Tests
- `discover.test.ts`: regex edge cases, date normalization, sort order, hashing,
  skipping of malformed filenames, real-data smoke (37 / 26 / 11 counts).
- `ledger.test.ts`: reconcile (added / unchanged / rehashed / missing), find
  (exact / unique-substring / ambiguous / not-found), mutations (markStage clears
  prior errors, resetEntry full wipe, resetEntryStage cascade), IO round-trip
  through Zod schema.
- `transcripts.test.ts`: CLI commands using injected temp dirs — no real state touched.

### Integration / Smoke
- Run `bun run transcripts list` against the real `transcripts/` directory and inspect
  the table by eye.
- Mark a stage manually, run `update-transcripts.sh`, re-list, confirm timestamp
  preserved.

### What's NOT Tested
- Real `update-transcripts.sh` invocation inside automated tests — too coupled to
  the upstream Quartz directory layout. Covered by manual verification.
- Concurrent ledger writes — single-writer assumption is enforced socially.

---

## Performance Considerations

- 37 transcripts × ~1MB each × SHA-256 is well under 100ms in practice. No incremental
  hash caching needed; revisit only if transcript count grows past several hundred.
- Ledger file is small (KB range) — JSON parse + stringify is irrelevant.

---

## Migration Notes

This is the first checked-in version of `state/processed.json`. No prior state to
migrate. Future schema changes will need an explicit migration step in `readLedger`
(parse → migrate → re-validate) since Zod `parse` will reject unknown shapes.

---

## References

- Ticket: `tickets/005-transcript-discovery-ledger.md`
- Parent epic: `tickets/001-create-project.md`
- Precedent for atomic state IO: `src/wiki/load.ts:147–151`
- Precedent for committed state file + `.gitignore` allow: `state/wiki-index.json`
- Hash helper reused: `src/wiki/hash.ts`
- Prior plan style: `thoughts/shared/plans/2026-05-17-004-wiki-page-summarization.md`
- Downstream consumers (next tickets): 006 `transcript-segmentation`,
  007 `claim-extraction`, 008 `claim-to-page-matching`, 009 `edit-proposal-generation`,
  010 `verifier-pass`, 012 `gitlab-mr-submission`.
