import { test, expect } from 'bun:test';
import { draftProse, type DraftCompleteFn } from './draft';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';

function draftStub(text: string, capture?: (user: string, model: string, stage: string) => void): DraftCompleteFn {
  return (async (args) => {
    capture?.(args.user, args.model, args.stage);
    return {
      text: '',
      usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
      value: { draft: text },
    } as unknown as CompleteResult<z.ZodTypeAny>;
  }) as DraftCompleteFn;
}

test('returns the trimmed draft from the injected completeFn', async () => {
  const { draft } = await draftProse(
    { canonicalName: 'Sableclutch', kind: 'create', facts: [{ text: 'a river district' }] },
    { completeFn: draftStub('  Overlooked by the capital, Sableclutch works the river.  ') },
  );
  expect(draft).toBe('Overlooked by the capital, Sableclutch works the river.');
});

test('passes the cited facts (and only them) into the prompt under the draft stage', async () => {
  let user = '';
  let stage = '';
  await draftProse(
    {
      canonicalName: 'Hallia',
      kind: 'amend',
      facts: [{ text: 'Hallia gained a tram called the Horizon.' }],
      pageContext: 'Hallia is a hill district above the river.',
    },
    { model: 'test-model', completeFn: draftStub('x', (u, _m, s) => { user = u; stage = s; }) },
  );
  expect(stage).toBe('draft');
  expect(user).toContain('Hallia gained a tram called the Horizon.');
  // amend → the existing page prose is supplied as the voice reference
  expect(user).toContain('Hallia is a hill district above the river.');
});

test('honors an injected model override', async () => {
  let model = '';
  await draftProse(
    { canonicalName: 'X', kind: 'create', facts: [] },
    { model: 'my-draft-model', completeFn: draftStub('y', (_u, m) => { model = m; }) },
  );
  expect(model).toBe('my-draft-model');
});
