import { test, expect } from 'bun:test';
import { scoreCoverage, scoreFalseCanon, claimMatchesFact } from './score';
import type { Claim } from '../pipeline/types';
import type { LabeledFact } from './labels';

function claim(partial: Partial<Claim> & Pick<Claim, 'text'>): Claim {
  return {
    id: partial.id ?? 'c1',
    text: partial.text,
    citations: partial.citations ?? [{ transcript: 't.txt', start: 1, end: 1 }],
    speaker: partial.speaker ?? 'Gamemaster',
    role: partial.role ?? 'gm',
    modality: partial.modality ?? 'gm-stated',
    entitySurfaceForms: partial.entitySurfaceForms ?? [],
  };
}

const FACT: LabeledFact = {
  id: 'f1',
  statement: 'The Roundhat Gang controls the Fousan warehouses.',
  entities: ['Roundhat Gang', 'Fousan'],
};

test('a near-paraphrase with shared entity matches the fact', () => {
  const c = claim({
    text: 'The Roundhat Gang now controls the warehouses by the Fousan.',
    entitySurfaceForms: ['Roundhat Gang'],
  });
  expect(claimMatchesFact(FACT, c)).toBe(true);
});

test('an unrelated claim does not match', () => {
  const c = claim({ text: 'Argyle owes a debt to a dockworker named Pell.', entitySurfaceForms: ['Pell'] });
  expect(claimMatchesFact(FACT, c)).toBe(false);
});

test('coverage counts matched facts and lists the misses', () => {
  const facts: LabeledFact[] = [
    FACT,
    { id: 'f2', statement: 'Sableclutch flooded during the spring tide.', entities: ['Sableclutch'] },
  ];
  const claims = [
    claim({ text: 'The Roundhat Gang controls the Fousan warehouses.', entitySurfaceForms: ['Roundhat Gang', 'Fousan'] }),
  ];
  const r = scoreCoverage(facts, claims);
  expect(r.total).toBe(2);
  expect(r.covered).toBe(1);
  expect(r.coverage).toBe(0.5);
  expect(r.missed.map((f) => f.id)).toEqual(['f2']);
});

test('false-canon rate flags canon claims matching no labeled fact', () => {
  const facts = [FACT];
  const claims = [
    claim({ text: 'The Roundhat Gang controls the Fousan warehouses.', entitySurfaceForms: ['Roundhat Gang', 'Fousan'] }),
    claim({ text: 'A dragon secretly rules the city.', modality: 'gm-stated', entitySurfaceForms: ['dragon'] }),
    claim({ text: 'Maybe the gang moved.', modality: 'player-speculation', entitySurfaceForms: ['gang'] }),
  ];
  const r = scoreFalseCanon(facts, claims);
  expect(r.canonClaims).toBe(2); // only the two gm-stated claims
  expect(r.unmatched).toBe(1);   // the dragon claim
  expect(r.falseCanonRate).toBe(0.5);
});

test('empty facts yields full coverage and zero false-canon', () => {
  expect(scoreCoverage([], []).coverage).toBe(1);
  expect(scoreFalseCanon([], []).falseCanonRate).toBe(0);
});
