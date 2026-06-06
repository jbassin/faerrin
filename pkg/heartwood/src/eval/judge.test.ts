import { test, expect } from 'bun:test';
import { judgeMatchMap, matcherFromMap, type JudgeCompleteFn } from './judge';
import { scoreSession } from './run';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';
import type { EvalLabel } from './labels';
import type { Claim } from '../pipeline/types';

const JudgeValue = (matches: { claimId: string; factId: string | null }[]) =>
  ({
    text: '',
    usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
    value: { matches },
  }) as CompleteResult<z.ZodTypeAny>;

function stub(matches: { claimId: string; factId: string | null }[]): JudgeCompleteFn {
  return (async () => JudgeValue(matches)) as JudgeCompleteFn;
}

function claim(id: string, text: string): Claim {
  return { id, text, citations: [{ transcript: 't', start: 1, end: 1 }], speaker: 'Gamemaster', role: 'gm', modality: 'gm-stated', entitySurfaceForms: [] };
}

const label: EvalLabel = {
  session: { arc: 'a', date: '2025-01-01' },
  canonFacts: [
    { id: 'f1', statement: 'Iomenei walks on six legs.', entities: ['Iomenei'] },
    { id: 'f2', statement: 'The Undercroft houses crofters.', entities: ['Undercroft'] },
  ],
};

test('judge maps candidates to canonical facts (semantic, not token)', async () => {
  const claims = [
    claim('c1', 'The Strider is propelled by six legs.'), // semantically == f1, low token overlap
    claim('c2', 'A piece of scrap blocked the lubricant intake.'), // noise → null
  ];
  const map = await judgeMatchMap(label.canonFacts, claims, {
    model: 'test',
    completeFn: stub([
      { claimId: 'c1', factId: 'f1' },
      { claimId: 'c2', factId: null },
    ]),
  });
  expect(map.get('c1')).toBe('f1');
  expect(map.get('c2')).toBeNull();
});

test('matcherFromMap drives scoreSession (judge gives full credit where token would miss)', async () => {
  const claims = [
    claim('c1', 'The Strider is propelled by six legs.'),
    claim('c2', 'A piece of scrap blocked the lubricant intake.'),
  ];
  const map = await judgeMatchMap(label.canonFacts, claims, {
    model: 'test',
    completeFn: stub([
      { claimId: 'c1', factId: 'f1' },
      { claimId: 'c2', factId: null },
    ]),
  });
  const score = scoreSession(label, claims, matcherFromMap(map));
  expect(score.coverage.covered).toBe(1);          // f1 matched semantically
  expect(score.coverage.missed.map((f) => f.id)).toEqual(['f2']);
  expect(score.precision.matched).toBe(1);         // c1 matched, c2 is noise
  expect(score.precision.unmatched[0]!.id).toBe('c2');
});

test('unknown / omitted claim ids resolve to null', async () => {
  const claims = [claim('c1', 'x'), claim('c2', 'y')];
  const map = await judgeMatchMap(label.canonFacts, claims, {
    model: 'test',
    completeFn: stub([{ claimId: 'c1', factId: 'bogus-fact-id' }]), // bad id + c2 omitted
  });
  expect(map.get('c1')).toBeNull(); // invalid factId scrubbed
  expect(map.get('c2')).toBeNull(); // omission filled
});
