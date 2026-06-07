import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireSurface,
  applyConflictResolution,
  applyDecision,
  clearDefer,
  conflictResolutionFor,
  decisionFor,
  deferConflict,
  emptyReviewState,
  isCommentProcessed,
  isMergeable,
  isSurfaceHeld,
  readReviewState,
  recordProcessedComment,
  releaseSurface,
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

// ── NLSpec 0002 deltas: session lock, conflict-defer, command audit ──────────────────────────

describe('session lock — one ledger, one active surface (NLSpec 0002 D-4/D-13, AC-7)', () => {
  it('acquires when free and is idempotent for the same surface', () => {
    let s = emptyReviewState(SID);
    expect(isSurfaceHeld(s)).toBe(false);

    const acquired = acquireSurface(s, { surface: 'pr', prNumber: 42, branch: 'hw/x' });
    expect(acquired).not.toBeNull();
    s = acquired!;
    expect(isSurfaceHeld(s)).toBe(true);
    expect(s.reviewSurface!.surface).toBe('pr');
    expect(s.reviewSurface!.prNumber).toBe(42);
    const firstAcquiredAt = s.reviewSurface!.acquiredAt;

    // Re-acquire by the same surface refreshes linkage but keeps the original acquiredAt.
    const re = acquireSurface(s, { surface: 'pr', prNumber: 42, branch: 'hw/x', lastBotBookmarkTarget: 'abc' });
    expect(re).not.toBeNull();
    expect(re!.reviewSurface!.lastBotBookmarkTarget).toBe('abc');
    expect(re!.reviewSurface!.acquiredAt).toBe(firstAcquiredAt);
  });

  it('CAS: the other surface loses the race (near-simultaneous opens settle to one winner)', () => {
    const s = emptyReviewState(SID);
    const web = acquireSurface(s, { surface: 'web' });
    expect(web).not.toBeNull();
    // The PR bot now tries to open the same session → blocked.
    expect(acquireSurface(web!, { surface: 'pr', prNumber: 7 })).toBeNull();
  });

  it('releases the lock so the other surface can take it (AC-17 close, AC-21 merge)', () => {
    let s = acquireSurface(emptyReviewState(SID), { surface: 'pr', prNumber: 1 })!;
    s = releaseSurface(s);
    expect(isSurfaceHeld(s)).toBe(false);
    expect(acquireSurface(s, { surface: 'web' })).not.toBeNull();
    // releasing an already-free state is a no-op (returns same reference)
    expect(releaseSurface(s)).toBe(s);
  });
});

describe('conflict defer blocks merge (NLSpec 0002 D-12, AC-24)', () => {
  it('a fresh session with no deferred conflicts is mergeable', () => {
    expect(isMergeable(emptyReviewState(SID))).toBe(true);
  });

  it('/defer leaves the conflict unresolved AND blocks merge', () => {
    let s = applyConflictResolution(emptyReviewState(SID), 'c1', 'accepted');
    s = deferConflict(s, 'c1');
    // defer clears the prior accept/reject — it is genuinely unresolved now
    expect(conflictResolutionFor(s, 'c1')).toBeUndefined();
    expect(s.deferredConflicts).toEqual(['c1']);
    expect(isMergeable(s)).toBe(false);
  });

  it('deferring is idempotent', () => {
    let s = deferConflict(emptyReviewState(SID), 'c1');
    s = deferConflict(s, 'c1');
    expect(s.deferredConflicts).toEqual(['c1']);
  });

  it('a later resolution clears the defer (last-write-wins, AC-24)', () => {
    let s = deferConflict(emptyReviewState(SID), 'c1');
    expect(isMergeable(s)).toBe(false);
    s = applyConflictResolution(s, 'c1', 'rejected');
    expect(s.deferredConflicts).toEqual([]);
    expect(conflictResolutionFor(s, 'c1')).toBe('rejected');
    expect(isMergeable(s)).toBe(true);
  });

  it('clearDefer removes a defer without resolving it', () => {
    let s = deferConflict(emptyReviewState(SID), 'c1');
    s = clearDefer(s, 'c1');
    expect(s.deferredConflicts).toEqual([]);
    expect(clearDefer(s, 'nope')).toBe(s); // no-op returns same reference
  });
});

describe('command idempotency audit (NLSpec 0002 §7, AC-13)', () => {
  it('records processed comment ids and detects re-reads', () => {
    let s = emptyReviewState(SID);
    expect(isCommentProcessed(s, 'IC_123')).toBe(false);
    s = recordProcessedComment(s, 'IC_123', 'rejected');
    expect(isCommentProcessed(s, 'IC_123')).toBe(true);
    expect(s.processedComments['IC_123']).toBe('rejected');
  });
});

describe('migration tolerance: an old review file loads with the new fields defaulted', () => {
  it('reads a pre-0002 file with no lock/defer/audit fields', async () => {
    await withTmp(async (dir) => {
      const { reviewStatePath } = await import('./review');
      const { writeFileAtomic } = await import('./atomic');
      const old = {
        sessionId: SID,
        decisions: {},
        conflictResolutions: { a: 'accepted' },
        promotedClaims: [],
        updatedAt: '2026-06-06T00:00:00.000Z',
      };
      await writeFileAtomic(reviewStatePath(dir, SID), JSON.stringify(old));
      const back = await readReviewState(dir, SID);
      expect(back.reviewSurface).toBeNull();
      expect(back.deferredConflicts).toEqual([]);
      expect(back.processedComments).toEqual({});
      expect(isMergeable(back)).toBe(true);
    });
  });
});
