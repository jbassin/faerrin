import { test, expect } from 'bun:test';
import {
  emptyLedger,
  reconcile,
  markStage,
  recordError,
  resetEntryStage,
  findBySession,
  findEntry,
  EMPTY_STAGES,
  type Ledger,
} from './ledger';
import type { TranscriptFile } from './discover';
import type { SessionId } from '../state/identity';

function file(arc: string, date: string, hash: string): TranscriptFile {
  return {
    filename: `000.${arc}.${date}.txt`,
    campaignId: 0,
    campaignName: arc,
    sessionDate: date,
    isMain: true,
    contentHash: hash,
    byteLength: 100,
  };
}

const ARC = 'through-a-song-darkly';
const A = file(ARC, '2025-08-28', 'hash-a');
const B = file(ARC, '2026-01-20', 'hash-b'); // same arc, different date
const SA: SessionId = { arc: ARC, date: '2025-08-28' };

test('reconcile adds new sessions keyed by (arc, date)', () => {
  const r = reconcile(emptyLedger(), [A, B]);
  expect(r.changes.added).toEqual([`${ARC}@2025-08-28`, `${ARC}@2026-01-20`]);
  expect(r.ledger.entries).toHaveLength(2);
});

test('two sessions of the same arc are distinct entries', () => {
  const r = reconcile(emptyLedger(), [A, B]);
  expect(findBySession(r.ledger, SA)).toBeDefined();
  expect(findBySession(r.ledger, { arc: ARC, date: '2026-01-20' })).toBeDefined();
});

test('unchanged hash preserves the entry and its stages', () => {
  let ledger: Ledger = reconcile(emptyLedger(), [A]).ledger;
  ledger = markStage(ledger, SA, 'mined');
  const r = reconcile(ledger, [A]);
  expect(r.changes.unchanged).toEqual([`${ARC}@2025-08-28`]);
  expect(findBySession(r.ledger, SA)!.stages.mined).not.toBeNull();
});

test('a changed hash clears stages so the session re-runs (AC-25)', () => {
  let ledger: Ledger = reconcile(emptyLedger(), [A]).ledger;
  ledger = markStage(ledger, SA, 'mined');
  const r = reconcile(ledger, [{ ...A, contentHash: 'hash-a2' }]);
  expect(r.changes.rehashed).toEqual([`${ARC}@2025-08-28`]);
  expect(findBySession(r.ledger, SA)!.stages).toEqual(EMPTY_STAGES);
});

test('markStage clears that stage\'s errors; recordError accumulates', () => {
  let ledger: Ledger = reconcile(emptyLedger(), [A]).ledger;
  ledger = recordError(ledger, SA, 'mined', 'boom');
  expect(findBySession(ledger, SA)!.errors).toHaveLength(1);
  ledger = markStage(ledger, SA, 'mined');
  expect(findBySession(ledger, SA)!.errors).toHaveLength(0);
});

test('resetEntryStage clears the stage and all later stages', () => {
  let ledger: Ledger = reconcile(emptyLedger(), [A]).ledger;
  for (const s of ['mined', 'triaged', 'resolved', 'located'] as const) {
    ledger = markStage(ledger, SA, s);
  }
  ledger = resetEntryStage(ledger, SA, 'resolved');
  const st = findBySession(ledger, SA)!.stages;
  expect(st.mined).not.toBeNull();
  expect(st.triaged).not.toBeNull();
  expect(st.resolved).toBeNull();
  expect(st.located).toBeNull();
});

test('findEntry matches by arc@date key and reports ambiguity by arc', () => {
  const ledger = reconcile(emptyLedger(), [A, B]).ledger;
  expect(findEntry(ledger, `${ARC}@2025-08-28`)).toMatchObject({ ok: true });
  expect(findEntry(ledger, 'nope')).toEqual({ ok: false, reason: 'not_found' });
  expect(findEntry(ledger, ARC).ok).toBe(false); // matches both sessions
});
