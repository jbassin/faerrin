import { test, expect } from 'bun:test';
import {
  normalizeStr, bestTokenPairDistance, buildEntityLookup, resolveTranscript,
} from './resolve';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import type { complete } from '../llm';

// ---- Helpers ----

function makeIndex(pages: Record<string, { title: string; aliases?: string[] }>): WikiIndex {
  const out: WikiIndex = { generatedAt: '', pageCount: 0, pages: {}, unresolvedLinks: [] };
  for (const [path, p] of Object.entries(pages)) {
    out.pages[path] = {
      path,
      title: p.title,
      aliases: p.aliases ?? [],
      tags: [],
      img: null,
      headings: [],
      wikilinks: [],
      contentHash: 'x',
      byteLength: 10,
      summary: null,
      keyFacts: null,
      entities: null,
    };
    out.pageCount++;
  }
  return out;
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    claim: 'The entity does something.',
    lines: [1, 2],
    speaker: 'Gamemaster',
    role: 'gm',
    confidence: 'stated',
    entities: [],
    sourceSegmentStartLine: 1,
    ...overrides,
  };
}

// LLM that confirms all candidates.
const confirmAllFake: typeof complete = (async (args: any) => {
  const lines: string[] = (args.user as string).split('\n').filter((l: string) => l.startsWith('['));
  const confirmations = lines.map((l: string) => {
    const m = l.match(/^\[(\d+)\]/);
    return { index: Number(m![1]), confirmed: true };
  });
  return { text: '', usage: {} as never, value: { confirmations } };
}) as never;

// LLM that rejects all candidates.
const rejectAllFake: typeof complete = (async () => {
  return { text: '', usage: {} as never, value: { confirmations: [] } };
}) as never;

// LLM that records call count.
let llmCallCount = 0;
const countingConfirmFake: typeof complete = (async (args: any) => {
  llmCallCount++;
  return confirmAllFake(args);
}) as never;

// ---- normalizeStr ----

test('normalizeStr lowercases and collapses hyphens to spaces', () => {
  expect(normalizeStr('Gin-Soaked Rag')).toBe('gin soaked rag');
});

test('normalizeStr collapses em-dashes and multiple spaces', () => {
  expect(normalizeStr('Foo–Bar—Baz  Qux')).toBe('foo bar baz qux');
});

// ---- bestTokenPairDistance ----

test('bestTokenPairDistance: Roundhack vs Roundhat Gang → ratio ≤ threshold (0.25)', () => {
  // "roundhack" vs "roundhat" = 2 edits / 9 chars ≈ 0.222
  const d = bestTokenPairDistance('roundhack', 'roundhat gang');
  expect(d).toBeLessThanOrEqual(0.25);
});

test('bestTokenPairDistance: Anok vs Anouk Marchal → ratio ≤ threshold', () => {
  // "anok" vs "anouk" = 1/5 = 0.2
  const d = bestTokenPairDistance('anok', 'anouk marchal');
  expect(d).toBeLessThanOrEqual(0.25);
});

test('bestTokenPairDistance: short tokens (<4 chars) are skipped', () => {
  // only "gin" and "rag" — both < 4 chars — should skip, returning Infinity
  const d = bestTokenPairDistance('gin rag', 'gin soaked rag');
  expect(d).toBe(Infinity);
});

test('bestTokenPairDistance: clearly unrelated strings → ratio > 0.25', () => {
  const d = bestTokenPairDistance('tywelwyn', 'roundhat gang');
  expect(d).toBeGreaterThan(0.25);
});

// ---- buildEntityLookup ----

test('buildEntityLookup: alias resolves to canonical page', () => {
  const index = makeIndex({
    'Org/Gin Soaked Rag/index': { title: 'Gin Soaked Rag', aliases: ['Ginny'] },
  });
  const { exactMap } = buildEntityLookup(index);
  const hit = exactMap.get('ginny');
  expect(hit).toBeDefined();
  expect(hit!.title).toBe('Gin Soaked Rag');
  expect(hit!.path).toBe('Org/Gin Soaked Rag/index');
});

test('buildEntityLookup: normalized title resolves (Gin-Soaked Rag → Gin Soaked Rag)', () => {
  const index = makeIndex({
    'Org/Gin Soaked Rag/index': { title: 'Gin Soaked Rag', aliases: [] },
  });
  const { exactMap } = buildEntityLookup(index);
  // Normalized "Gin-Soaked Rag" = "gin soaked rag"
  expect(exactMap.get('gin soaked rag')).toBeDefined();
});

test('buildEntityLookup: Rules/* pages excluded from fuzzy entries', () => {
  const index = makeIndex({
    'Rules/Something': { title: 'Some Rule' },
    'Org/Foo': { title: 'Foo' },
  });
  const { fuzzyEntries } = buildEntityLookup(index);
  expect(fuzzyEntries.every((e) => !e.path.startsWith('Rules/'))).toBe(true);
  expect(fuzzyEntries.length).toBe(1);
});

// ---- resolveTranscript ----

test('resolveTranscript: exact alias match → method exact, suggestAlias false', async () => {
  const index = makeIndex({
    'Org/Gin Soaked Rag/index': { title: 'Gin Soaked Rag', aliases: ['Ginny'] },
  });
  const claims = [makeClaim({ entities: ['Ginny'] })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: rejectAllFake,
  });
  const r = out[0]!.entityResolutions[0]!;
  expect(r.method).toBe('exact');
  expect(r.canonical).toBe('Gin Soaked Rag');
  expect(r.suggestAlias).toBe(false);
});

test('resolveTranscript: format variant Gin-Soaked Rag → Gin Soaked Rag via exact', async () => {
  const index = makeIndex({
    'Org/Gin Soaked Rag/index': { title: 'Gin Soaked Rag', aliases: [] },
  });
  const claims = [makeClaim({ entities: ['Gin-Soaked Rag'] })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: rejectAllFake,
  });
  const r = out[0]!.entityResolutions[0]!;
  expect(r.method).toBe('exact');
  expect(r.canonical).toBe('Gin Soaked Rag');
  expect(r.suggestAlias).toBe(false);
});

test('resolveTranscript: fuzzy+LLM confirmed → Roundhack resolves to Roundhat Gang, suggestAlias true', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
  });
  const claims = [makeClaim({
    claim: 'The Roundhack gang is run by Tywelwyn Leatherhide.',
    entities: ['Roundhack'],
  })];
  const { claims: out, aliasSuggestions } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: confirmAllFake,
  });
  const r = out[0]!.entityResolutions[0]!;
  expect(r.method).toBe('llm');
  expect(r.canonical).toBe('Roundhat Gang');
  expect(r.suggestAlias).toBe(true);
  expect(aliasSuggestions.length).toBe(1);
  expect(aliasSuggestions[0]!.variant).toBe('Roundhack');
  expect(aliasSuggestions[0]!.page).toBe('Org/Roundhat Gang/index');
});

test('resolveTranscript: fuzzy+LLM rejected → method none, original preserved', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
  });
  const claims = [makeClaim({ entities: ['Roundhack'] })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: rejectAllFake,
  });
  const r = out[0]!.entityResolutions[0]!;
  expect(r.method).toBe('none');
  expect(r.canonical).toBe('Roundhack');
  expect(r.page).toBeNull();
});

test('resolveTranscript: unknown entity with no fuzzy candidate → method none, page null', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
  });
  const claims = [makeClaim({ entities: ['Copperjaw'] })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: rejectAllFake,
  });
  const r = out[0]!.entityResolutions[0]!;
  expect(r.method).toBe('none');
  expect(r.page).toBeNull();
});

test('resolveTranscript: claim text is rewritten when LLM confirms', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
  });
  const claims = [makeClaim({
    claim: 'The Roundhack gang is run by someone.',
    entities: ['Roundhack'],
  })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: confirmAllFake,
  });
  expect(out[0]!.claim).toContain('Roundhat Gang');
  expect(out[0]!.claim).not.toContain('Roundhack');
});

test('resolveTranscript: entities array updated to canonical after LLM confirm', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
  });
  const claims = [makeClaim({ entities: ['Roundhack'] })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: confirmAllFake,
  });
  expect(out[0]!.entities[0]).toBe('Roundhat Gang');
});

test('resolveTranscript: aliasSuggestions deduplicated and occurrences counted', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
  });
  // Two claims both using "Roundhack" → one suggestion with occurrences=2.
  const claims = [
    makeClaim({ claim: 'The Roundhack gang appears here.', entities: ['Roundhack'] }),
    makeClaim({ claim: 'Roundhack controls the district.', entities: ['Roundhack'] }),
  ];
  const { aliasSuggestions } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: confirmAllFake,
  });
  expect(aliasSuggestions.length).toBe(1);
  expect(aliasSuggestions[0]!.occurrences).toBe(2);
});

test('resolveTranscript: all fuzzy candidates batched in one LLM call', async () => {
  const index = makeIndex({
    'Org/Roundhat Gang/index': { title: 'Roundhat Gang', aliases: [] },
    'Org/Iconoclasm/People/Anouk Marchal': { title: 'Anouk Marchal', aliases: [] },
  });
  llmCallCount = 0;
  const claims = [
    makeClaim({ entities: ['Roundhack', 'Anok'] }),
  ];
  await resolveTranscript(claims, index, {
    model: 'fake', completeFn: countingConfirmFake,
  });
  expect(llmCallCount).toBe(1);
});

test('resolveTranscript: variant already in wiki aliases → suggestAlias false', async () => {
  const index = makeIndex({
    'Org/Gin Soaked Rag/index': { title: 'Gin Soaked Rag', aliases: ['Ginny', 'Gin Soaked'] },
  });
  // "Gin Soaked" normalized = "gin soaked" → exact match via alias → suggestAlias false
  const claims = [makeClaim({ entities: ['Gin Soaked'] })];
  const { claims: out } = await resolveTranscript(claims, index, {
    model: 'fake', completeFn: rejectAllFake,
  });
  const r = out[0]!.entityResolutions[0]!;
  expect(r.method).toBe('exact');
  expect(r.suggestAlias).toBe(false);
});
