import { test, expect } from 'bun:test';
import { scoreSession, formatScore } from './run';
import type { EvalLabel } from './labels';
import type { Claim } from '../pipeline/types';

function claim(text: string, p: Partial<Claim> = {}): Claim {
  return {
    id: p.id ?? 'c1',
    text,
    citations: [{ transcript: 't.txt', start: 1, end: 1 }],
    speaker: 'Gamemaster',
    role: 'gm',
    modality: p.modality ?? 'gm-stated',
    entitySurfaceForms: p.entitySurfaceForms ?? [],
  };
}

const label: EvalLabel = {
  session: { arc: 'arc', date: '2025-01-01' },
  canonFacts: [
    { id: 'f1', statement: 'Iomenei is a six-legged Strider City.', entities: ['Iomenei'] },
    { id: 'f2', statement: 'The Undercroft houses tens of thousands of crofters.', entities: ['Undercroft'] },
  ],
};

test('scoreSession computes coverage, precision, and false-canon', () => {
  const claims = [
    claim('Iomenei is a six-legged Strider City.', { entitySurfaceForms: ['Iomenei'] }), // matches f1
    claim('The strider was sabotaged by an elf.', { entitySurfaceForms: ['Iomenei'] }),  // noise, matches nothing
  ];
  const s = scoreSession(label, claims);
  expect(s.labeledFacts).toBe(2);
  expect(s.producedClaims).toBe(2);
  expect(s.coverage.covered).toBe(1); // f1 found, f2 missed
  expect(s.coverage.missed.map((f) => f.id)).toEqual(['f2']);
  expect(s.precision.matched).toBe(1); // one claim matched a kept fact
  expect(s.precision.precision).toBe(0.5);
  expect(s.precision.unmatched[0]!.text).toContain('sabotaged'); // the leaked noise
  expect(s.falseCanon.unmatched).toBe(1); // the sabotage gm-stated claim
});

test('formatScore renders a readable report', () => {
  const s = scoreSession(label, [claim('Iomenei is a six-legged Strider City.', { entitySurfaceForms: ['Iomenei'] })]);
  const out = formatScore(s);
  expect(out).toContain('Eval — arc@2025-01-01');
  expect(out).toContain('coverage (recall)');
  expect(out).toContain('precision');
});
