import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyConflictResolution,
  applyDecision,
  conflictResolutionFor,
  decisionFor,
  emptyReviewState,
  readReviewState,
  reviewStatus,
  togglePromotion,
  writeReviewState,
} from './review';

const SID = { arc: 'through-a-song-darkly', date: '2025-08-28' };

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'hw-review-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('review state', () => {
  it('reads a fresh empty state for an unopened session', async () => {
    await withTmp(async (dir) => {
      const s = await readReviewState(dir, SID);
      expect(s.decisions).toEqual({});
      expect(decisionFor(s, 'prop:e1')).toBe('pending');
    });
  });

  it('round-trips decisions and resumes (AC-8)', async () => {
    await withTmp(async (dir) => {
      let s = emptyReviewState(SID);
      s = applyDecision(s, { proposalId: 'prop:e1', decision: 'approved', authoredText: 'New prose.' });
      s = applyDecision(s, { proposalId: 'prop:e2', decision: 'deferred' });
      await writeReviewState(dir, s);

      const back = await readReviewState(dir, SID);
      expect(decisionFor(back, 'prop:e1')).toBe('approved');
      expect(back.decisions['prop:e1']!.authoredText).toBe('New prose.');
      expect(decisionFor(back, 'prop:e2')).toBe('deferred');
    });
  });

  it('computes session status from decisions vs proposals', () => {
    const ids = ['a', 'b', 'c'];
    let s = emptyReviewState(SID);
    expect(reviewStatus(s, ids)).toBe('unreviewed');

    s = applyDecision(s, { proposalId: 'a', decision: 'approved' });
    expect(reviewStatus(s, ids)).toBe('partial');

    s = applyDecision(s, { proposalId: 'b', decision: 'rejected' });
    s = applyDecision(s, { proposalId: 'c', decision: 'deferred' });
    // a deferred proposal keeps it partial (not terminal)
    expect(reviewStatus(s, ids)).toBe('partial');

    s = applyDecision(s, { proposalId: 'c', decision: 'approved' });
    expect(reviewStatus(s, ids)).toBe('reviewed');
  });

  it('empty proposal set is trivially reviewed', () => {
    expect(reviewStatus(emptyReviewState(SID), [])).toBe('reviewed');
  });

  it('records + round-trips conflict resolutions by claimId (AC-11)', async () => {
    await withTmp(async (dir) => {
      let s = emptyReviewState(SID);
      s = applyConflictResolution(s, 'c1', 'accepted');
      s = applyConflictResolution(s, 'c2', 'rejected');
      await writeReviewState(dir, s);
      const back = await readReviewState(dir, SID);
      expect(conflictResolutionFor(back, 'c1')).toBe('accepted');
      expect(conflictResolutionFor(back, 'c2')).toBe('rejected');
      expect(conflictResolutionFor(back, 'c3')).toBeUndefined();
    });
  });

  it('defaults conflictResolutions for older review files (schema default)', () => {
    // emptyReviewState always includes it; the schema default covers files written before AC-11.
    expect(emptyReviewState(SID).conflictResolutions).toEqual({});
  });

  it('migrates legacy supersede/coexist/reject resolutions on read (AC-11 rework)', async () => {
    await withTmp(async (dir) => {
      // Simulate an older review file written with the previous three-way model.
      const { reviewStatePath } = await import('./review');
      const legacy = {
        sessionId: SID,
        decisions: {},
        conflictResolutions: { a: 'supersede', b: 'coexist', c: 'reject', d: 'bogus' },
        promotedClaims: [],
        updatedAt: '2026-06-06T00:00:00.000Z',
      };
      const { writeFileAtomic } = await import('./atomic');
      await writeFileAtomic(reviewStatePath(dir, SID), JSON.stringify(legacy));
      const back = await readReviewState(dir, SID);
      expect(back.conflictResolutions).toEqual({ a: 'accepted', b: 'accepted', c: 'rejected' });
    });
  });

  it('toggles claim promotion (AC-14)', () => {
    let s = emptyReviewState(SID);
    expect(s.promotedClaims).toEqual([]);
    s = togglePromotion(s, 'c9');
    expect(s.promotedClaims).toEqual(['c9']);
    s = togglePromotion(s, 'c9');
    expect(s.promotedClaims).toEqual([]);
  });
});
