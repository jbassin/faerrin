import { test, expect } from 'bun:test';
import { detectConflicts, type ConflictCompleteFn } from './conflict';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';
import type { Proposal, ProposalFact } from './assemble';

function fact(claimId: string, text: string): ProposalFact {
  return { claimId, text, citations: [{ transcript: 't', start: 1, end: 1 }], modality: 'gm-stated' };
}

function amend(name: string, path: string, facts: ProposalFact[]): Proposal {
  return { id: `prop:${path}`, kind: 'amend', status: 'existing', entityId: `wiki:${path}`, canonicalName: name, targetPath: path, facts };
}
function create(name: string, facts: ProposalFact[]): Proposal {
  return { id: `prop:new:${name}`, kind: 'create', status: 'new', entityId: `new:${name}`, canonicalName: name, targetPath: null, facts };
}

function stub(conflicts: { claimId: string; existingStatement: string; explanation: string }[], onCall?: (page: string) => void): ConflictCompleteFn {
  return (async (args) => {
    onCall?.(args.page ?? '');
    return { text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 }, value: { conflicts } } as unknown as CompleteResult<z.ZodTypeAny>;
  }) as ConflictCompleteFn;
}

const reader = (bodies: Record<string, string>) => async (p: string) => bodies[p] ?? null;

test('flags a new fact that contradicts the existing page', async () => {
  const p = amend('Iomenei', 'Geo/Iomenei.md', [fact('c1', 'Iomenei walks on four legs.')]);
  const res = await detectConflicts([p], {
    readPage: reader({ 'Geo/Iomenei.md': 'Iomenei is a Strider City that walks on six legs.' }),
    completeFn: stub([{ claimId: 'c1', existingStatement: 'walks on six legs', explanation: 'six vs four legs' }]),
  });
  expect(res.checkedPages).toBe(1);
  expect(res.conflicts).toHaveLength(1);
  expect(res.conflicts[0]).toMatchObject({
    claimId: 'c1',
    newStatement: 'Iomenei walks on four legs.',
    existingStatement: 'walks on six legs',
    source: 'wiki',
    sourceRef: 'Geo/Iomenei.md',
  });
});

test('no contradiction yields no conflicts', async () => {
  const p = amend('Iomenei', 'Geo/Iomenei.md', [fact('c1', 'Iomenei has an Undercroft.')]);
  const res = await detectConflicts([p], {
    readPage: reader({ 'Geo/Iomenei.md': 'Iomenei walks on six legs.' }),
    completeFn: stub([]),
  });
  expect(res.conflicts).toHaveLength(0);
});

test('create proposals are not checked (nothing to contradict)', async () => {
  let called = false;
  const res = await detectConflicts([create('Copperjaw', [fact('c1', 'x')])], {
    readPage: reader({}),
    completeFn: stub([], () => { called = true; }),
  });
  expect(called).toBe(false);
  expect(res.checkedPages).toBe(0);
});

test('skips amends whose page is missing or empty', async () => {
  let called = false;
  const res = await detectConflicts([amend('Ghost', 'Geo/Ghost.md', [fact('c1', 'x')])], {
    readPage: reader({}), // returns null
    completeFn: stub([], () => { called = true; }),
  });
  expect(called).toBe(false);
  expect(res.checkedPages).toBe(0);
  expect(res.conflicts).toHaveLength(0);
});
