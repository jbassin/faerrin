import { test, expect } from 'bun:test';
import { assemble, type AssembleCompleteFn } from './assemble';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';
import type { Claim } from './types';
import type { ResolveResult, ResolvedEntity } from './resolve';

function claim(id: string, text: string): Claim {
  return { id, text, citations: [{ transcript: 't', start: 1, end: 1 }], speaker: 'Gamemaster', role: 'gm', modality: 'gm-stated', entitySurfaceForms: [] };
}

function entity(id: string, name: string, wikiPath: string | null): ResolvedEntity {
  return { id, canonicalName: name, aliases: [], wikiPath, status: wikiPath ? 'known' : 'pending', confidence: 'high' };
}

function narrativeStub(text: string, onCall?: () => void): AssembleCompleteFn {
  return (async () => {
    onCall?.();
    return { text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 }, value: { narrative: text } } as unknown as CompleteResult<z.ZodTypeAny>;
  }) as AssembleCompleteFn;
}

const hallia = claim('c1', 'Hallia has a tram called the Horizon.');
const copperjaw = claim('c2', 'Copperjaw runs Sableclutch Scrap.');
const copperjaw2 = claim('c3', 'Copperjaw has a copper-jaw prosthetic.');

const resolved: ResolveResult = {
  entities: [
    entity('wiki:Geography/Hallia.md', 'Hallia', 'Geography/Hallia.md'),
    entity('new:copperjaw', 'Copperjaw', null),
  ],
  claims: [
    { claim: hallia, entityIds: ['wiki:Geography/Hallia.md'] },
    { claim: copperjaw, entityIds: ['new:copperjaw'] },
    { claim: copperjaw2, entityIds: ['new:copperjaw'] },
  ],
  needsConfirmation: [],
};

test('groups canon claims into per-entity proposals (amend existing, create new)', async () => {
  const res = await assemble([hallia, copperjaw, copperjaw2], resolved, { model: 'test', completeFn: narrativeStub('summary') });
  expect(res.proposals).toHaveLength(2);

  const amend = res.proposals.find((p) => p.canonicalName === 'Hallia')!;
  expect(amend.kind).toBe('amend');
  expect(amend.status).toBe('existing');
  expect(amend.targetPath).toBe('Geography/Hallia.md');
  expect(amend.facts.map((f) => f.claimId)).toEqual(['c1']);

  const create = res.proposals.find((p) => p.canonicalName === 'Copperjaw')!;
  expect(create.kind).toBe('create');
  expect(create.targetPath).toBeNull();
  expect(create.facts.map((f) => f.claimId)).toEqual(['c2', 'c3']); // both facts grouped
});

test('amend proposals sort before create proposals', async () => {
  const res = await assemble([hallia, copperjaw], resolved, { model: 'test', completeFn: narrativeStub('s') });
  expect(res.proposals.map((p) => p.kind)).toEqual(['amend', 'create']);
});

test('a canon claim with no resolved entity lands in unassigned', async () => {
  const orphan = claim('c9', 'A homeless fact.');
  const res = await assemble([orphan], { entities: [], claims: [{ claim: orphan, entityIds: [] }], needsConfirmation: [] }, { model: 'test', completeFn: narrativeStub('s') });
  expect(res.proposals).toHaveLength(0);
  expect(res.unassigned.map((f) => f.claimId)).toEqual(['c9']);
});

test('narrative is generated from the canon facts', async () => {
  const res = await assemble([hallia], resolved, { model: 'test', completeFn: narrativeStub('Hallia gained a tram this session.') });
  expect(res.narrative).toBe('Hallia gained a tram this session.');
});

test('noNarrative skips the LLM call', async () => {
  let called = false;
  const res = await assemble([hallia], resolved, { model: 'test', noNarrative: true, completeFn: narrativeStub('x', () => { called = true; }) });
  expect(called).toBe(false);
  expect(res.narrative).toBe('');
});
