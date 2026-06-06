import { test, expect } from 'bun:test';
import { parseLabelAction, reviewLabels, type ReviewDeps } from './review';
import type { EvalLabel, LabeledFact } from './labels';

function fact(id: string, statement: string, extra: Partial<LabeledFact> = {}): LabeledFact {
  return { id, statement, entities: extra.entities ?? [], citations: extra.citations, reviewed: extra.reviewed };
}

function labelOf(...facts: LabeledFact[]): EvalLabel {
  return { session: { arc: 'arc', date: '2025-01-01' }, canonFacts: facts };
}

function scriptedDeps(keys: string[], lines: string[] = []): ReviewDeps & { out_: string[] } {
  const k = [...keys];
  const l = [...lines];
  const out_: string[] = [];
  return {
    out_,
    key: async () => k.shift() ?? 'q',
    line: async () => l.shift() ?? '',
    out: (s: string) => out_.push(s),
  };
}

test('parseLabelAction maps keystrokes', () => {
  expect(parseLabelAction('')).toEqual({ kind: 'approve' });
  expect(parseLabelAction('a')).toEqual({ kind: 'approve' });
  expect(parseLabelAction('E')).toEqual({ kind: 'edit' });
  expect(parseLabelAction('d')).toEqual({ kind: 'deny' });
  expect(parseLabelAction('s')).toEqual({ kind: 'skip' });
  expect(parseLabelAction('q')).toEqual({ kind: 'quit' });
  expect(parseLabelAction('?')).toBeNull();
});

test('approve keeps the fact and marks it reviewed', async () => {
  const { label, stats } = await reviewLabels(labelOf(fact('f1', 'A')), scriptedDeps(['a']));
  expect(stats.approved).toBe(1);
  expect(label.canonFacts).toHaveLength(1);
  expect(label.canonFacts[0]!.reviewed).toBe(true);
});

test('deny removes the fact', async () => {
  const { label, stats } = await reviewLabels(labelOf(fact('f1', 'A'), fact('f2', 'B')), scriptedDeps(['d', 'a']));
  expect(stats.denied).toBe(1);
  expect(label.canonFacts.map((f) => f.id)).toEqual(['f2']);
});

test('edit rewrites statement and entities', async () => {
  const { label, stats } = await reviewLabels(
    labelOf(fact('f1', 'old statement', { entities: ['X'] })),
    scriptedDeps(['e'], ['a better statement', 'Roundhat Gang, Fousan']),
  );
  expect(stats.edited).toBe(1);
  expect(label.canonFacts[0]!.statement).toBe('a better statement');
  expect(label.canonFacts[0]!.entities).toEqual(['Roundhat Gang', 'Fousan']);
  expect(label.canonFacts[0]!.reviewed).toBe(true);
});

test('edit with empty inputs keeps the originals', async () => {
  const { label } = await reviewLabels(
    labelOf(fact('f1', 'keep me', { entities: ['Y'] })),
    scriptedDeps(['e'], ['', '']),
  );
  expect(label.canonFacts[0]!.statement).toBe('keep me');
  expect(label.canonFacts[0]!.entities).toEqual(['Y']);
});

test('skip leaves the fact un-reviewed and present', async () => {
  const { label, stats } = await reviewLabels(labelOf(fact('f1', 'A')), scriptedDeps(['s']));
  expect(stats.skipped).toBe(1);
  expect(label.canonFacts[0]!.reviewed).toBeUndefined();
});

test('quit stops but preserves decisions already made', async () => {
  const { label, stats } = await reviewLabels(
    labelOf(fact('f1', 'A'), fact('f2', 'B'), fact('f3', 'C')),
    scriptedDeps(['d', 'q']), // deny f1, then quit on f2
  );
  expect(stats.quit).toBe(true);
  expect(stats.denied).toBe(1);
  expect(label.canonFacts.map((f) => f.id)).toEqual(['f2', 'f3']); // f1 dropped; f2/f3 untouched
});

test('already-reviewed facts are skipped, not re-shown', async () => {
  const { stats } = await reviewLabels(
    labelOf(fact('f1', 'A', { reviewed: true }), fact('f2', 'B')),
    scriptedDeps(['a']),
  );
  expect(stats.total).toBe(2);
  expect(stats.alreadyReviewed).toBe(1);
  expect(stats.approved).toBe(1);
});

test('unrecognized keystroke re-prompts until valid', async () => {
  const deps = scriptedDeps(['?', 'x', 'a']);
  const { stats } = await reviewLabels(labelOf(fact('f1', 'A')), deps);
  expect(stats.approved).toBe(1);
  expect(deps.out_.some((l) => l.includes('unrecognized'))).toBe(true);
});
