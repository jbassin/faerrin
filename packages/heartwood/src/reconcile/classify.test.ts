import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyCandidates } from './classify';
import type { CandidateResult } from './candidates';
import type { Claim } from '../transcript/extract';
import type { WikiIndex, PageRecord } from '../wiki/index-schema';
import type { complete } from '../llm';

// ---- Helpers ----

function makePage(path: string, title: string): PageRecord {
  return {
    path, title, aliases: [], tags: [], img: null, headings: [], wikilinks: [],
    contentHash: 'abc', byteLength: 100, summary: 'A page.', keyFacts: null, entities: null,
  };
}

function makeIndex(paths: string[]): WikiIndex {
  const pages: Record<string, PageRecord> = {};
  for (const p of paths) pages[p] = makePage(p, p.replace('.md', ''));
  return { generatedAt: '2026-01-01T00:00:00Z', pageCount: paths.length, pages, unresolvedLinks: [] };
}

function makeClaim(claim = 'A test claim'): Claim {
  return { claim, lines: [1, 2], speaker: 'Gamemaster', role: 'gm', confidence: 'stated', entities: [], sourceSegmentStartLine: 1 };
}

function makeCandidate(claimIndex: number, paths: string[]): CandidateResult {
  return { claimIndex, paths, fastMatched: paths.length > 0 };
}

// Fake completeFn that returns a consistent classification for each claim in the batch.
function makeClassifyFake(relation: 'consistent' | 'update' | 'new' | 'contradict' = 'consistent'): typeof complete {
  return (async (args: any) => {
    const lines = (args.user as string).split('\n').filter((l: string) => l.match(/^\[/));
    const results = lines.map((l: string) => {
      const m = l.match(/^\[(\d+)\]/);
      return { claimIndex: Number(m![1]), relation, rationale: 'Test rationale.', excerpt: null };
    });
    return { text: '', usage: {} as never, value: { results } };
  }) as never;
}

interface Setup {
  root: string;
  contentDir: string;
}

function setup(pages: Record<string, string> = {}): Setup {
  const root = mkdtempSync(join(tmpdir(), 'classify-test-'));
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

// ---- Tests ----

test('standalone-new: claim with paths:[] gets synthetic new entry; no LLM call', async () => {
  const s = setup();
  try {
    const claims = [makeClaim()];
    const candidates = [makeCandidate(0, [])];
    const index = makeIndex([]);
    const fakeFn: typeof complete = (async () => { throw new Error('should not be called'); }) as never;

    const results = await classifyCandidates(claims, candidates, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(results.length).toBe(1);
    expect(results[0]!.candidatePages.length).toBe(1);
    expect(results[0]!.candidatePages[0]!.path).toBeNull();
    expect(results[0]!.candidatePages[0]!.relation).toBe('new');
    expect(results[0]!.candidatePages[0]!.excerpt).toBeNull();
  } finally { teardown(s.root); }
});

test('single-page batch: 3 claims targeting same page → one LLM call, page loaded once', async () => {
  const pagePath = 'Org/Test.md';
  const s = setup({ [pagePath]: 'Page content here.' });
  try {
    const claims = [makeClaim('Claim 0'), makeClaim('Claim 1'), makeClaim('Claim 2')].map((c, i) => ({ ...c, claim: `Claim ${i}` }));
    const candidates = [0, 1, 2].map((i) => makeCandidate(i, [pagePath]));
    const index = makeIndex([pagePath]);

    let callCount = 0;
    let receivedClaimCount = 0;
    const fakeFn: typeof complete = (async (args: any) => {
      callCount++;
      const lines = (args.user as string).split('\n').filter((l: string) => l.match(/^\[/));
      receivedClaimCount = lines.length;
      const results = lines.map((l: string) => {
        const m = l.match(/^\[(\d+)\]/);
        return { claimIndex: Number(m![1]), relation: 'consistent', rationale: 'Covered.', excerpt: null };
      });
      return { text: '', usage: {} as never, value: { results } };
    }) as never;

    const results = await classifyCandidates(claims, candidates, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(callCount).toBe(1);
    expect(receivedClaimCount).toBe(3);
    expect(results.length).toBe(3);
    expect(results[0]!.candidatePages[0]!.path).toBe(pagePath);
  } finally { teardown(s.root); }
});

test('multi-page: claims targeting 2 different pages → 2 LLM calls, correct subsets', async () => {
  const pageA = 'Org/Alpha.md';
  const pageB = 'Org/Beta.md';
  const s = setup({ [pageA]: 'Alpha content.', [pageB]: 'Beta content.' });
  try {
    const claims = [makeClaim('Claim 0'), makeClaim('Claim 1')].map((c, i) => ({ ...c, claim: `Claim ${i}` }));
    const candidates = [
      makeCandidate(0, [pageA]),
      makeCandidate(1, [pageB]),
    ];
    const index = makeIndex([pageA, pageB]);

    const pagesReceived: string[] = [];
    const fakeFn: typeof complete = (async (args: any) => {
      pagesReceived.push(args.cached);
      const lines = (args.user as string).split('\n').filter((l: string) => l.match(/^\[/));
      const results = lines.map((l: string) => {
        const m = l.match(/^\[(\d+)\]/);
        return { claimIndex: Number(m![1]), relation: 'update', rationale: 'New info.', excerpt: null };
      });
      return { text: '', usage: {} as never, value: { results } };
    }) as never;

    const results = await classifyCandidates(claims, candidates, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(pagesReceived.length).toBe(2);
    expect(pagesReceived.some((c) => c.includes(pageA))).toBe(true);
    expect(pagesReceived.some((c) => c.includes(pageB))).toBe(true);
    expect(results[0]!.candidatePages[0]!.path).toBe(pageA);
    expect(results[1]!.candidatePages[0]!.path).toBe(pageB);
  } finally { teardown(s.root); }
});

test('LLM hallucinated index: claimIndex not in batch is silently dropped', async () => {
  const pagePath = 'Org/Test.md';
  const s = setup({ [pagePath]: 'Content.' });
  try {
    const claims = [makeClaim()];
    const candidates = [makeCandidate(0, [pagePath])];
    const index = makeIndex([pagePath]);

    const fakeFn: typeof complete = (async () => {
      return {
        text: '', usage: {} as never,
        value: { results: [
          { claimIndex: 99, relation: 'new', rationale: 'Hallucinated.', excerpt: null },
          { claimIndex: 0, relation: 'consistent', rationale: 'Real.', excerpt: null },
        ]},
      };
    }) as never;

    const results = await classifyCandidates(claims, candidates, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    // Only index 0 should be accepted; index 99 dropped.
    expect(results[0]!.candidatePages.length).toBe(1);
    expect(results[0]!.candidatePages[0]!.relation).toBe('consistent');
  } finally { teardown(s.root); }
});

test('byte cap warning: large page triggers console.warn', async () => {
  const pagePath = 'Org/Huge.md';
  const hugeText = 'x'.repeat(600_000);
  const s = setup({ [pagePath]: hugeText });
  try {
    const claims = [makeClaim()];
    const candidates = [makeCandidate(0, [pagePath])];
    const index = makeIndex([pagePath]);

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    try {
      await classifyCandidates(claims, candidates, index, {
        model: 'fake',
        contentDir: s.contentDir,
        byteCap: 500_000,
        completeFn: makeClassifyFake(),
      });
    } finally {
      console.warn = origWarn;
    }

    expect(warnings.some((w) => w.includes('exceeds') && w.includes('500000'))).toBe(true);
  } finally { teardown(s.root); }
});

test('order preservation: candidate paths [A, B] → candidatePages has A before B', async () => {
  const pageA = 'Org/Alpha.md';
  const pageB = 'Org/Beta.md';
  const s = setup({ [pageA]: 'Alpha.', [pageB]: 'Beta.' });
  try {
    const claims = [makeClaim()];
    // Candidate has A first, then B.
    const candidates = [makeCandidate(0, [pageA, pageB])];
    const index = makeIndex([pageA, pageB]);

    // LLM returns B first, then A — classifier should re-sort by candidate order.
    const fakeFn: typeof complete = (async (args: any) => {
      const isPageA = (args.cached as string).includes(pageA);
      const idx = 0;
      const relation = isPageA ? 'consistent' : 'update';
      return {
        text: '', usage: {} as never,
        value: { results: [{ claimIndex: idx, relation, rationale: 'r', excerpt: null }] },
      };
    }) as never;

    const results = await classifyCandidates(claims, candidates, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(results[0]!.candidatePages[0]!.path).toBe(pageA);
    expect(results[0]!.candidatePages[1]!.path).toBe(pageB);
  } finally { teardown(s.root); }
});

test('excerpt null: null excerpt propagated correctly', async () => {
  const pagePath = 'Org/Test.md';
  const s = setup({ [pagePath]: 'Content.' });
  try {
    const claims = [makeClaim()];
    const candidates = [makeCandidate(0, [pagePath])];
    const index = makeIndex([pagePath]);

    const fakeFn: typeof complete = (async () => {
      return {
        text: '', usage: {} as never,
        value: { results: [{ claimIndex: 0, relation: 'new', rationale: 'r', excerpt: null }] },
      };
    }) as never;

    const results = await classifyCandidates(claims, candidates, index, {
      model: 'fake', contentDir: s.contentDir, completeFn: fakeFn,
    });

    expect(results[0]!.candidatePages[0]!.excerpt).toBeNull();
  } finally { teardown(s.root); }
});

test('onPageClassified callback receives correct pagePath, claimIndices, rawResults, classifiedResults', async () => {
  const pagePath = 'Org/Test.md';
  const s = setup({ [pagePath]: 'Content.' });
  try {
    const claims = [makeClaim('First'), makeClaim('Second')].map((c, i) => ({ ...c, claim: i === 0 ? 'First' : 'Second' }));
    const candidates = [makeCandidate(0, [pagePath]), makeCandidate(1, [pagePath])];
    const index = makeIndex([pagePath]);

    let callbackArgs: any = null;
    await classifyCandidates(claims, candidates, index, {
      model: 'fake',
      contentDir: s.contentDir,
      completeFn: makeClassifyFake('update'),
      onPageClassified: (path, indices, rawResults, classifiedResults) => {
        callbackArgs = { path, indices, rawResults, classifiedResults };
      },
    });

    expect(callbackArgs.path).toBe(pagePath);
    expect(callbackArgs.indices).toContain(0);
    expect(callbackArgs.indices).toContain(1);
    expect(Array.isArray(callbackArgs.rawResults)).toBe(true);
    expect(Array.isArray(callbackArgs.classifiedResults)).toBe(true);
  } finally { teardown(s.root); }
});
