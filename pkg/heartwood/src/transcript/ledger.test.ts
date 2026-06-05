import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyLedger, reconcile, findEntry,
  markStage, recordError, setPrUrl, setPrNumber, resetEntry, resetEntryStage,
  readLedger, writeLedger, LedgerSchema,
  EMPTY_STAGES,
} from './ledger';
import type { TranscriptFile } from './discover';

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
  const next = reconcile(prior, [f]);
  expect(next.changes.unchanged).toEqual([f.filename]);
  expect(next.changes.rehashed).toEqual([]);
  expect(next.ledger.entries[0]!.stages.segmented).toBe('2026-01-01T00:00:00Z');
});

test('reconcile clears stages when contentHash differs', () => {
  const f = fixtureFile();
  const stale = markStage(reconcile(emptyLedger(), [f]).ledger, f.filename, 'segmented');
  const stale2 = setPrUrl(stale, f.filename, 'https://github.com/owner/repo/pull/7');
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

test('setPrNumber sets prNumber on the entry', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = setPrNumber(l, f.filename, 42);
  expect(l.entries[0]!.prNumber).toBe(42);
});

test('prNumber survives LedgerSchema round-trip', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = setPrNumber(l, f.filename, 99);
  const parsed = LedgerSchema.parse(JSON.parse(JSON.stringify(l)));
  expect(parsed.entries[0]!.prNumber).toBe(99);
});

test('legacy mrIid is read as prNumber (GitLab→GitHub back-compat)', () => {
  const legacy = {
    entries: [{
      filename: 'x.txt', contentHash: 'abc',
      stages: { ...EMPTY_STAGES, prOpened: '2026-01-01T00:00:00.000Z' },
      mrIid: 5, errors: [],
    }],
  };
  const parsed = LedgerSchema.parse(legacy);
  expect(parsed.entries[0]!.prNumber).toBe(5);
  expect((parsed.entries[0]! as Record<string, unknown>).mrIid).toBeUndefined();
});

test('resetEntry clears all stages, errors, prUrl, and prNumber', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = markStage(l, f.filename, 'segmented');
  l = markStage(l, f.filename, 'extracted');
  l = setPrUrl(l, f.filename, 'https://example/pr/1');
  l = setPrNumber(l, f.filename, 7);
  l = recordError(l, f.filename, 'matched', 'boom');
  l = resetEntry(l, f.filename);
  expect(l.entries[0]!.stages).toEqual(EMPTY_STAGES);
  expect(l.entries[0]!.errors).toEqual([]);
  expect(l.entries[0]!.prUrl).toBeUndefined();
  expect(l.entries[0]!.prNumber).toBeUndefined();
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
  expect(l.entries[0]!.prUrl).toBeUndefined();
});

test('resetEntryStage clears prUrl when cascade reaches prOpened', () => {
  const f = fixtureFile();
  let l = reconcile(emptyLedger(), [f]).ledger;
  l = setPrUrl(l, f.filename, 'https://example/mr/1');
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

test('legacy ledger JSON without resolved field parses correctly (backwards compat)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const path = join(dir, 'processed.json');
    // Write a raw ledger entry that lacks the `resolved` field (pre-ticket-015 format).
    const raw = {
      entries: [{
        filename: '000.alpha.2025-8-28.txt',
        contentHash: 'hash-A',
        stages: {
          segmented: '2026-01-01T00:00:00Z',
          extracted: '2026-01-02T00:00:00Z',
          // resolved intentionally absent
          matched:   '2026-01-03T00:00:00Z',
          proposed:  null,
          verified:  null,
          prOpened:  null,
        },
        errors: [],
      }],
    };
    await Bun.write(path, JSON.stringify(raw, null, 2) + '\n');
    const l = await readLedger(path);
    const e = l.entries[0]!;
    expect(e.stages.segmented).toBe('2026-01-01T00:00:00Z');
    expect(e.stages.extracted).toBe('2026-01-02T00:00:00Z');
    expect(e.stages.resolved).toBeNull();    // absent → null
    expect(e.stages.matched).toBe('2026-01-03T00:00:00Z');
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
    const raw = JSON.parse(await Bun.file(path).text());
    expect(() => LedgerSchema.parse(raw)).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
