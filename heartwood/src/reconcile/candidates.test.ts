import { test, expect } from 'bun:test';
import { findCandidates, buildIndexSummary } from './candidates';
import type { WikiIndex, PageRecord } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';
import type { complete } from '../llm';

// ---- Helpers ----

function makePage(path: string, title: string, aliases: string[] = [], summary = 'A page.'): PageRecord {
  return {
    path,
    title,
    aliases,
    tags: [],
    img: null,
    headings: [],
    wikilinks: [],
    contentHash: 'abc',
    byteLength: 100,
    summary,
    keyFacts: null,
    entities: null,
  };
}

function makeIndex(pages: Record<string, PageRecord>): WikiIndex {
  return { generatedAt: '2026-01-01T00:00:00Z', pageCount: Object.keys(pages).length, pages, unresolvedLinks: [] };
}

function makeClaim(entities: string[], claim = 'Test claim'): Claim {
  return { claim, lines: [1, 2], speaker: 'Gamemaster', role: 'gm', confidence: 'stated', entities, sourceSegmentStartLine: 1 };
}

const HOST_PATH = 'Divinity/Outer Gods/Iridescent Host.md';
const PLACE_PATH = 'Geography/Some Place.md';
const RULE_PATH = 'Rules/Some Rule.md';

const baseIndex = makeIndex({
  [HOST_PATH]: makePage(HOST_PATH, 'Iridescent Host', ['Host'], 'An outer god.'),
  [PLACE_PATH]: makePage(PLACE_PATH, 'Some Place', [], 'A location.'),
  [RULE_PATH]: makePage(RULE_PATH, 'Some Rule', [], 'A game rule.'),
});

// Fake completeFn that never gets called (asserts no LLM call happens).
const noCallFake: typeof complete = (async () => {
  throw new Error('completeFn should not have been called');
}) as never;

// ---- Tests ----

test('fast match: title matches a claim entity', async () => {
  const claims = [makeClaim(['Iridescent Host'])];
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: noCallFake });
  expect(results[0]!.paths).toEqual([HOST_PATH]);
  expect(results[0]!.fastMatched).toBe(true);
});

test('alias match: alias matches a claim entity', async () => {
  const claims = [makeClaim(['Host'])];
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: noCallFake });
  expect(results[0]!.paths).toEqual([HOST_PATH]);
  expect(results[0]!.fastMatched).toBe(true);
});

test('case-insensitive match', async () => {
  const claims = [makeClaim(['iridescent host'])];
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: noCallFake });
  expect(results[0]!.paths).toEqual([HOST_PATH]);
  expect(results[0]!.fastMatched).toBe(true);
});

test('Rules/* exclusion: Rules page never returned even if entity matches', async () => {
  const claims = [makeClaim(['Some Rule'])];
  let llmCalled = false;
  const fakeFn: typeof complete = (async () => {
    llmCalled = true;
    return { text: '', usage: {} as never, value: { matches: [] } };
  }) as never;
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  // No fast match (Rules excluded), so falls through to LLM. LLM returns nothing.
  expect(results[0]!.paths).toEqual([]);
  expect(results[0]!.fastMatched).toBe(false);
  expect(llmCalled).toBe(true);
});

test('cap at 3: claim with 5 matching entities returns at most 3 paths', async () => {
  const idx = makeIndex({
    'A.md': makePage('A.md', 'Alpha'),
    'B.md': makePage('B.md', 'Beta'),
    'C.md': makePage('C.md', 'Gamma'),
    'D.md': makePage('D.md', 'Delta'),
    'E.md': makePage('E.md', 'Epsilon'),
  });
  const claims = [makeClaim(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'])];
  const results = await findCandidates(claims, idx, { model: 'fake', completeFn: noCallFake });
  expect(results[0]!.paths.length).toBe(3);
  expect(results[0]!.fastMatched).toBe(true);
});

test('LLM fallback triggered for claim with no entities', async () => {
  const claims = [makeClaim([])];
  let receivedUser = '';
  const fakeFn: typeof complete = (async (args: any) => {
    receivedUser = args.user;
    return { text: '', usage: {} as never, value: { matches: [{ claimIndex: 0, paths: [HOST_PATH] }] } };
  }) as never;
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  expect(receivedUser).toContain('[0] Test claim');
  expect(results[0]!.paths).toEqual([HOST_PATH]);
  expect(results[0]!.fastMatched).toBe(false);
});

test('LLM fallback: invalid path dropped silently', async () => {
  const claims = [makeClaim([])];
  const fakeFn: typeof complete = (async () => {
    return {
      text: '', usage: {} as never,
      value: { matches: [{ claimIndex: 0, paths: ['NonExistent/Page.md', HOST_PATH] }] },
    };
  }) as never;
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  expect(results[0]!.paths).toEqual([HOST_PATH]);
});

test('batch boundary: 45 unmatched claims → 3 batches with batchSize=20', async () => {
  const claims: Claim[] = [];
  for (let i = 0; i < 45; i++) claims.push(makeClaim([], `Claim ${i}`));

  let callCount = 0;
  const batchSizes: number[] = [];
  const fakeFn: typeof complete = (async (args: any) => {
    callCount++;
    const lines = (args.user as string).split('\n');
    batchSizes.push(lines.length);
    return { text: '', usage: {} as never, value: { matches: [] } };
  }) as never;

  await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn, batchSize: 20 });
  expect(callCount).toBe(3);
  expect(batchSizes).toEqual([20, 20, 5]);
});

test('all-matched: zero fallback calls if all claims fast-match', async () => {
  const claims = [makeClaim(['Iridescent Host']), makeClaim(['Some Place'])];
  let callCount = 0;
  const fakeFn: typeof complete = (async () => {
    callCount++;
    return { text: '', usage: {} as never, value: { matches: [] } };
  }) as never;
  await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  expect(callCount).toBe(0);
});

test('empty entities: claim with entities:[] goes to fallback', async () => {
  const claims = [makeClaim([])];
  let llmCalled = false;
  const fakeFn: typeof complete = (async () => {
    llmCalled = true;
    return { text: '', usage: {} as never, value: { matches: [] } };
  }) as never;
  await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  expect(llmCalled).toBe(true);
});

test('standalone-new: no fast match and fallback returns empty → paths:[]', async () => {
  const claims = [makeClaim([])];
  const fakeFn: typeof complete = (async () => {
    return { text: '', usage: {} as never, value: { matches: [] } };
  }) as never;
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  expect(results[0]!.paths).toEqual([]);
  expect(results[0]!.fastMatched).toBe(false);
});

test('buildIndexSummary: excludes Rules/* entries', () => {
  const summary = buildIndexSummary(baseIndex);
  expect(summary).not.toContain(RULE_PATH);
  expect(summary).toContain(HOST_PATH);
  expect(summary).toContain(PLACE_PATH);
});

test('buildIndexSummary: each line contains path, title, and summary', () => {
  const summary = buildIndexSummary(baseIndex);
  expect(summary).toContain('Divinity/Outer Gods/Iridescent Host.md — Iridescent Host');
  expect(summary).toContain('An outer god.');
});

test('buildIndexSummary: includes aliases in parentheses', () => {
  const summary = buildIndexSummary(baseIndex);
  expect(summary).toContain('(Host)');
});

test('LLM fallback: Rules/* path returned by LLM is dropped', async () => {
  const claims = [makeClaim([])];
  const fakeFn: typeof complete = (async () => {
    return {
      text: '', usage: {} as never,
      value: { matches: [{ claimIndex: 0, paths: [RULE_PATH, HOST_PATH] }] },
    };
  }) as never;
  const results = await findCandidates(claims, baseIndex, { model: 'fake', completeFn: fakeFn });
  // RULE_PATH is not in validPaths (it starts with Rules/), so it gets filtered
  expect(results[0]!.paths).not.toContain(RULE_PATH);
  expect(results[0]!.paths).toContain(HOST_PATH);
});
