import { test, expect } from 'bun:test';
import { resolve, type ResolveCompleteFn } from './resolve';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';
import type { Claim } from './types';
import type { WikiIndex, PageRecord } from '../wiki/index-schema';

function page(path: string, title: string, aliases: string[] = []): PageRecord {
  return { path, title, aliases, tags: [], img: null, headings: [], wikilinks: [], contentHash: '', byteLength: 0, summary: null, keyFacts: null, entities: null };
}

function wikiIndex(): WikiIndex {
  return {
    generatedAt: '', pageCount: 2, unresolvedLinks: [],
    pages: {
      'Geography/Calaria/Hallia/index.md': page('Geography/Calaria/Hallia/index.md', 'Hallia'),
      'Org/Threshold Authority.md': page('Org/Threshold Authority.md', 'Threshold Authority', ['TA']),
    },
  };
}

function claim(id: string, entitySurfaceForms: string[]): Claim {
  return { id, text: 'x', citations: [{ transcript: 't', start: 1, end: 1 }], speaker: 'Gamemaster', role: 'gm', modality: 'gm-stated', entitySurfaceForms };
}

function stub(resolutions: { surfaceForm: string; matchedKnown: string | null; canonicalName: string }[], onCall?: () => void): ResolveCompleteFn {
  return (async () => {
    onCall?.();
    return { text: '', usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 }, value: { resolutions } } as unknown as CompleteResult<z.ZodTypeAny>;
  }) as ResolveCompleteFn;
}

test('exact wiki title/alias matches resolve high-confidence, no LLM call', async () => {
  let called = false;
  const res = await resolve([claim('c1', ['Hallia']), claim('c2', ['TA'])], {
    index: wikiIndex(),
    completeFn: stub([], () => { called = true; }),
  });
  expect(called).toBe(false);
  const hallia = res.entities.find((e) => e.canonicalName === 'Hallia')!;
  expect(hallia.status).toBe('known');
  expect(hallia.confidence).toBe('high');
  expect(hallia.wikiPath).toBe('Geography/Calaria/Hallia/index.md');
  const ta = res.entities.find((e) => e.canonicalName === 'Threshold Authority')!;
  expect(ta.confidence).toBe('high'); // matched via alias "TA"
  expect(res.needsConfirmation).toHaveLength(0);
});

test('LLM maps a referent to a known entity as a low-confidence merge', async () => {
  const res = await resolve([claim('c1', ['the TA guys'])], {
    index: wikiIndex(),
    completeFn: stub([{ surfaceForm: 'the TA guys', matchedKnown: 'Threshold Authority', canonicalName: 'Threshold Authority' }]),
  });
  const ta = res.entities.find((e) => e.canonicalName === 'Threshold Authority')!;
  expect(ta.status).toBe('known');
  expect(ta.confidence).toBe('low'); // LLM merge → confirm
  expect(ta.aliases).toContain('the TA guys');
  expect(res.needsConfirmation.map((e) => e.canonicalName)).toContain('Threshold Authority');
});

test('LLM clusters spelling variants into one new pending entity', async () => {
  const res = await resolve([claim('c1', ['Iomene']), claim('c2', ['Iominae'])], {
    index: wikiIndex(),
    completeFn: stub([
      { surfaceForm: 'Iomene', matchedKnown: null, canonicalName: 'Iomenei' },
      { surfaceForm: 'Iominae', matchedKnown: null, canonicalName: 'Iomenei' },
    ]),
  });
  const iomenei = res.entities.find((e) => e.canonicalName === 'Iomenei')!;
  expect(iomenei.status).toBe('pending');
  expect(iomenei.wikiPath).toBeNull();
  expect(iomenei.aliases.sort()).toEqual(['Iomene', 'Iominae']);
  expect(res.needsConfirmation).toContain(iomenei);
});

test('claims are annotated with their resolved entity ids', async () => {
  const c = claim('c1', ['Hallia', 'TA']);
  const res = await resolve([c], { index: wikiIndex(), completeFn: stub([]) });
  const rc = res.claims.find((x) => x.claim.id === 'c1')!;
  expect(rc.entityIds).toContain('wiki:Geography/Calaria/Hallia/index.md');
  expect(rc.entityIds).toContain('wiki:Org/Threshold Authority.md');
});
