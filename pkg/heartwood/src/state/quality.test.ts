import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyRejectionStore,
  isSuppressed,
  reasonTally,
  recordRejection,
  rejectionCount,
  rejectionEntryFor,
  readRejectionStore,
  removeRejection,
  rejectionSummary,
  signatureFor,
  writeRejectionStore,
} from './quality';

describe('signatureFor', () => {
  test('is stable across cosmetic differences (whitespace, wikilinks, emphasis)', () => {
    expect(signatureFor('The  Verdant   Expanse is *vast*.')).toBe(
      signatureFor('the [[Geography/Verdant Expanse|Verdant Expanse]] is vast.'),
    );
  });

  test('distinguishes genuinely different claims', () => {
    expect(signatureFor('Raelion was destroyed.')).not.toBe(signatureFor('Raelion was rebuilt.'));
  });
});

describe('recordRejection / removeRejection', () => {
  test('records a reason and counts one session', () => {
    const store = recordRejection(emptyRejectionStore(), {
      text: 'X is a large scrapyard.',
      reason: 'out-of-voice',
      sessionKey: '000@2025-10-20',
    });
    const entry = rejectionEntryFor(store, 'X is a large scrapyard.')!;
    expect(rejectionCount(entry)).toBe(1);
    expect(entry.bySession['000@2025-10-20']?.reason).toBe('out-of-voice');
  });

  test('is idempotent per session (re-recording does not inflate the count)', () => {
    let store = recordRejection(emptyRejectionStore(), {
      text: 'same claim',
      reason: 'not-canon',
      sessionKey: 's1',
    });
    store = recordRejection(store, { text: 'same claim', reason: 'hallucinated', sessionKey: 's1' });
    const entry = rejectionEntryFor(store, 'same claim')!;
    expect(rejectionCount(entry)).toBe(1);
    // latest reason wins for that session
    expect(entry.bySession['s1']?.reason).toBe('hallucinated');
  });

  test('counts distinct sessions separately', () => {
    let store = recordRejection(emptyRejectionStore(), { text: 'c', reason: 'not-canon', sessionKey: 'a' });
    store = recordRejection(store, { text: 'c', reason: 'not-canon', sessionKey: 'b' });
    expect(rejectionCount(rejectionEntryFor(store, 'c')!)).toBe(2);
  });

  test('removing the only session deletes the entry', () => {
    let store = recordRejection(emptyRejectionStore(), { text: 'c', sessionKey: 'a' });
    store = removeRejection(store, 'c', 'a');
    expect(rejectionEntryFor(store, 'c')).toBeUndefined();
  });

  test('removing one session of several keeps the rest', () => {
    let store = recordRejection(emptyRejectionStore(), { text: 'c', sessionKey: 'a' });
    store = recordRejection(store, { text: 'c', sessionKey: 'b' });
    store = removeRejection(store, 'c', 'a');
    const entry = rejectionEntryFor(store, 'c')!;
    expect(rejectionCount(entry)).toBe(1);
    expect(entry.bySession['b']).toBeDefined();
  });

  test('removing a non-existent session is a no-op', () => {
    const store = recordRejection(emptyRejectionStore(), { text: 'c', sessionKey: 'a' });
    expect(removeRejection(store, 'c', 'zzz')).toBe(store);
  });
});

describe('isSuppressed (AC-26 cross-session only)', () => {
  test('suppresses a claim rejected in a different session', () => {
    const store = recordRejection(emptyRejectionStore(), { text: 'old claim', sessionKey: 'earlier' });
    expect(isSuppressed(store, 'old claim', 'current')).toBe(true);
  });

  test('does NOT suppress a claim only rejected in the current session', () => {
    const store = recordRejection(emptyRejectionStore(), { text: 'mine', sessionKey: 'current' });
    expect(isSuppressed(store, 'mine', 'current')).toBe(false);
  });

  test('an unrejected claim is never suppressed', () => {
    expect(isSuppressed(emptyRejectionStore(), 'anything', 'current')).toBe(false);
  });
});

describe('rejectionSummary', () => {
  test('reports session count and the most recent reason', () => {
    let store = recordRejection(emptyRejectionStore(), {
      text: 'x',
      reason: 'not-canon',
      sessionKey: 's1',
      at: '2026-01-01T00:00:00.000Z',
    });
    store = recordRejection(store, {
      text: 'x',
      reason: 'out-of-voice',
      sessionKey: 's2',
      at: '2026-02-01T00:00:00.000Z',
    });
    expect(rejectionSummary(rejectionEntryFor(store, 'x')!)).toEqual({
      sessions: 2,
      reason: 'out-of-voice',
    });
  });
});

describe('reasonTally', () => {
  test('aggregates reasons across entries and sessions', () => {
    let store = recordRejection(emptyRejectionStore(), { text: 'a', reason: 'out-of-voice', sessionKey: 's1' });
    store = recordRejection(store, { text: 'a', reason: 'out-of-voice', sessionKey: 's2' });
    store = recordRejection(store, { text: 'b', reason: 'not-canon', sessionKey: 's1' });
    expect(reasonTally(store)).toEqual({ 'out-of-voice': 2, 'not-canon': 1 });
  });
});

describe('store round-trip', () => {
  test('write then read returns an equal store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hw-quality-'));
    try {
      const store = recordRejection(emptyRejectionStore(), {
        text: 'persist me',
        reason: 'wrong-page',
        sessionKey: 's1',
        at: '2026-06-06T00:00:00.000Z',
      });
      await writeRejectionStore(dir, store);
      expect(await readRejectionStore(dir)).toEqual(store);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reading a missing store yields an empty one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hw-quality-'));
    try {
      expect(await readRejectionStore(dir)).toEqual(emptyRejectionStore());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
