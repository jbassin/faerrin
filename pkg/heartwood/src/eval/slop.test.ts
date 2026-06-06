import { describe, expect, test } from 'bun:test';
import { slopRate, type SlopInput } from './slop';

describe('slopRate', () => {
  test('empty input → zero rate, nothing decided', () => {
    expect(slopRate([])).toEqual({
      decided: 0,
      voiceRejections: 0,
      rewrites: 0,
      slop: 0,
      slopRate: 0,
      byReason: {},
    });
  });

  test('counts only voice/quality rejections as slop, not all rejections', () => {
    const inputs: SlopInput[] = [
      { decision: 'approved' },
      { decision: 'rejected', rejectionReason: 'out-of-voice' }, // slop
      { decision: 'rejected', rejectionReason: 'not-canon' }, // a real rejection, NOT slop
      { decision: 'rejected', rejectionReason: 'hallucinated' }, // slop
    ];
    const r = slopRate(inputs);
    expect(r.decided).toBe(4);
    expect(r.voiceRejections).toBe(2);
    expect(r.slop).toBe(2);
    expect(r.slopRate).toBeCloseTo(0.5, 5);
    expect(r.byReason).toEqual({ 'out-of-voice': 1, 'not-canon': 1, hallucinated: 1 });
  });

  test('deferred and pending are not decided (excluded from the denominator)', () => {
    const r = slopRate([
      { decision: 'approved' },
      { decision: 'deferred' },
      { decision: 'pending' },
    ]);
    expect(r.decided).toBe(1);
    expect(r.slopRate).toBe(0);
  });

  test('is non-circular: a rejection with no reason contributes no slop', () => {
    const r = slopRate([{ decision: 'rejected' }]);
    expect(r.decided).toBe(1);
    expect(r.voiceRejections).toBe(0);
    expect(r.slopRate).toBe(0);
  });

  test('approved-but-rewritten-away-from-draft counts as slop (D-5 forward-compat)', () => {
    const r = slopRate([
      // kept the draft almost verbatim → not slop
      {
        decision: 'approved',
        draftText: 'Sableclutch is overlooked by the rest of the capital.',
        authoredText: 'Sableclutch is overlooked by the rest of the capital.',
      },
      // rewrote it wholesale → slop
      {
        decision: 'approved',
        draftText: 'X is a large scrapyard located within the neighborhood.',
        authoredText: 'The yard swallows whatever the river spits back, and the city pretends not to look.',
      },
    ]);
    expect(r.decided).toBe(2);
    expect(r.rewrites).toBe(1);
    expect(r.slopRate).toBeCloseTo(0.5, 5);
  });

  test('approved with no draft never counts as a rewrite (v1 human-authored)', () => {
    const r = slopRate([{ decision: 'approved', authoredText: 'freshly written prose' }]);
    expect(r.rewrites).toBe(0);
    expect(r.slopRate).toBe(0);
  });
});
