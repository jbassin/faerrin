import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchTranscript } from './match';
import type { Claim } from '../transcript/extract';
import type { WikiIndex, PageRecord } from '../wiki/index-schema';
import type { complete } from '../llm';

// ---- Helpers ----

function makePage(path: string, title: string, byteLength = 200): PageRecord {
  return {
    path, title, aliases: [], tags: [], img: null, headings: [], wikilinks: [],
    contentHash: 'abc', byteLength, summary: 'A page.', keyFacts: null, entities: null,
  };
}

function makeIndex(entries: Array<[string, string, number?]>): WikiIndex {
  const pages: Record<string, PageRecord> = {};
  for (const [path, title, bytes] of entries) pages[path] = makePage(path, title, bytes);
  return { generatedAt: '2026-01-01T00:00:00Z', pageCount: entries.length, pages, unresolvedLinks: [] };
}

function makeClaim(entities: string[], claim = 'A claim'): Claim {
  return { claim, lines: [1, 2], speaker: 'Gamemaster', role: 'gm', confidence: 'stated', entities, sourceSegmentStartLine: 1 };
}

interface Setup {
  root: string;
  contentDir: string;
}

function setup(pages: Record<string, string> = {}): Setup {
  const root = mkdtempSync(join(tmpdir(), 'match-test-'));
  const contentDir = join(root, 'content');
  mkdirSync(contentDir, { recursive: true });
  for (const [path, text] of Object.entries(pages)) {
    const full = join(contentDir, path);
    mkdirSync(full.substring(0, full.lastIndexOf('/')), { recursive: true });
    writeFileSync(full, text);
  }
  return { root, contentDir };
}

function teardown(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

// Fake completeFn that handles both candidate and classifier stages.
function makeFakeFn(candidatePaths: Record<number, string[]> = {}, classifyRelation: 'consistent' | 'new' = 'consistent'): typeof complete {
  return (async (args: any) => {
    if (args.stage === 'match-candidates') {
      const lines = (args.user as string).split('\n');
      const matches = lines.map((l: string) => {
        const m = l.match(/^\[(\d+)\]/);
        if (!m) return null;
        const idx = Number(m[1]);
        return { claimIndex: idx, paths: candidatePaths[idx] ?? [] };
      }).filter(Boolean);
      return { text: '', usage: {} as never, value: { matches } };
    }
    // match-classify
    const lines = (args.user as string).split('\n').filter((l: string) => l.match(/^\[/));
    const results = lines.map((l: string) => {
      const m = l.match(/^\[(\d+)\]/);
      return { claimIndex: Number(m![1]), relation: classifyRelation, rationale: 'r', excerpt: null };
    });
    return { text: '', usage: {} as never, value: { results } };
  }) as never;
}

// ---- Tests ----

test('happy path: 5 claims, 3 fast-match, 2 go to fallback, matches has 5 entries in order', async () => {
  const pageA = 'Org/Alpha.md';
  const pageB = 'Org/Beta.md';
  const s = setup({ [pageA]: 'Alpha.', [pageB]: 'Beta.' });
  try {
    const index = makeIndex([[pageA, 'Alpha'], [pageB, 'Beta']]);
    const claims = [
      makeClaim(['Alpha'], 'Claim 0'),
      makeClaim(['Beta'], 'Claim 1'),
      makeClaim(['Alpha'], 'Claim 2'),
      makeClaim([], 'Claim 3'),  // no fast match
      makeClaim([], 'Claim 4'),  // no fast match
    ];

    // LLM fallback: claims 3 and 4 get pageA
    const fakeFn = makeFakeFn({ 3: [pageA], 4: [pageB] });

    const result = await matchTranscript(claims, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(result.matches.length).toBe(5);
    expect(result.matches[0]!.claim.claim).toBe('Claim 0');
    expect(result.matches[4]!.claim.claim).toBe('Claim 4');
  } finally { teardown(s.root); }
});

test('stats: correct counts for candidateBatches, classifierBatches, pagesLoaded, bytesLoaded', async () => {
  const pageA = 'Org/Alpha.md';
  const s = setup({ [pageA]: 'Alpha content.' });
  try {
    const index = makeIndex([[pageA, 'Alpha', 500]]);
    // One claim fast-matches, one goes to fallback.
    const claims = [makeClaim(['Alpha'], 'C0'), makeClaim([], 'C1')];

    const fakeFn = makeFakeFn({ 1: [pageA] });

    const result = await matchTranscript(claims, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn, batchSize: 20,
    });

    expect(result.stats.totalClaims).toBe(2);
    expect(result.stats.candidateBatches).toBe(1); // one fallback batch
    expect(result.stats.classifierBatches).toBe(1); // one page
    expect(result.stats.pagesLoaded).toBe(1);
    expect(result.stats.bytesLoaded).toBe(500);
  } finally { teardown(s.root); }
});

test('all standalone-new: all claims have no match and LLM returns empty', async () => {
  const s = setup();
  try {
    const index = makeIndex([]);
    const claims = [makeClaim([], 'C0'), makeClaim([], 'C1'), makeClaim([], 'C2')];

    const fakeFn: typeof complete = (async () => {
      return { text: '', usage: {} as never, value: { matches: [] } };
    }) as never;

    const result = await matchTranscript(claims, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(result.stats.standaloneNew).toBe(3);
    expect(result.stats.pagesLoaded).toBe(0);
    for (const m of result.matches) {
      expect(m.candidatePages.length).toBe(1);
      expect(m.candidatePages[0]!.path).toBeNull();
      expect(m.candidatePages[0]!.relation).toBe('new');
    }
  } finally { teardown(s.root); }
});

test('claim order preserved: matches[i].claim === claims[i]', async () => {
  const pageA = 'Org/Alpha.md';
  const s = setup({ [pageA]: 'Alpha.' });
  try {
    const index = makeIndex([[pageA, 'Alpha']]);
    const claims = [
      makeClaim(['Alpha'], 'First'),
      makeClaim([], 'Second'),
      makeClaim(['Alpha'], 'Third'),
    ];

    const fakeFn = makeFakeFn({ 1: [] });

    const result = await matchTranscript(claims, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(result.matches[0]!.claim).toBe(claims[0]!);
    expect(result.matches[1]!.claim).toBe(claims[1]!);
    expect(result.matches[2]!.claim).toBe(claims[2]!);
  } finally { teardown(s.root); }
});
