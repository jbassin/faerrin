import { test, expect } from 'bun:test';
import { triage, clampByModality, type TriageCompleteFn } from './triage';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';
import type { Claim, Modality } from './types';

function claim(id: string, modality: Modality, text = 'x'): Claim {
  return { id, text, citations: [{ transcript: 't', start: 1, end: 1 }], speaker: 'Gamemaster', role: 'gm', modality, entitySurfaceForms: ['E'] };
}

function stub(classifications: { claimId: string; category: 'canon' | 'uncertain' | 'noise'; reason: string }[]): TriageCompleteFn {
  return (async () =>
    ({
      text: '',
      usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
      value: { classifications },
    }) as unknown as CompleteResult<z.ZodTypeAny>) as TriageCompleteFn;
}

test('clampByModality enforces the AC-5 hard rule', () => {
  expect(clampByModality('canon', 'player-speculation')).toBe('uncertain');
  expect(clampByModality('canon', 'in-character-fiction')).toBe('uncertain');
  expect(clampByModality('canon', 'gm-stated')).toBe('canon');
  expect(clampByModality('canon', 'noise')).toBe('noise');
  expect(clampByModality('uncertain', 'gm-stated')).toBe('uncertain');
});

test('partitions claims into canon / uncertain / noise', async () => {
  const claims = [
    claim('c1', 'gm-stated', 'Iomenei is a Strider City.'),
    claim('c2', 'gm-stated', 'An elf sabotaged the leg.'),
    claim('c3', 'gm-stated', 'Maybe relevant.'),
  ];
  const res = await triage(claims, {
    model: 'test',
    completeFn: stub([
      { claimId: 'c1', category: 'canon', reason: 'setting fact' },
      { claimId: 'c2', category: 'noise', reason: 'current-case detail' },
      { claimId: 'c3', category: 'uncertain', reason: 'ambiguous' },
    ]),
  });
  expect(res.canon.map((c) => c.id)).toEqual(['c1']);
  expect(res.noise.map((c) => c.id)).toEqual(['c2']);
  expect(res.uncertain.map((c) => c.id)).toEqual(['c3']);
});

test('a player-speculation claim the model called canon is downgraded to uncertain', async () => {
  const res = await triage([claim('c1', 'player-speculation', 'A guess.')], {
    model: 'test',
    completeFn: stub([{ claimId: 'c1', category: 'canon', reason: 'looks solid' }]),
  });
  expect(res.canon).toHaveLength(0);
  expect(res.uncertain.map((c) => c.id)).toEqual(['c1']);
});

test('unclassified claims default to uncertain (conservative)', async () => {
  const res = await triage([claim('c1', 'gm-stated')], { model: 'test', completeFn: stub([]) });
  expect(res.uncertain.map((c) => c.id)).toEqual(['c1']);
});

test('empty input yields empty buckets without an LLM call', async () => {
  let called = false;
  const res = await triage([], { model: 'test', completeFn: (async () => { called = true; return null as never; }) as TriageCompleteFn });
  expect(res.items).toHaveLength(0);
  expect(called).toBe(false);
});
