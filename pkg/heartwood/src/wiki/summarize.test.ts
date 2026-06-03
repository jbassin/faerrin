import { test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { summarizePage, summarizeWikiPages } from './summarize';
import type { SummarizeResult } from './summarize';
import type { PageRecord } from './index-schema';

// Self-contained fixtures: the wiki corpus is the shared-content SSOT, so these
// tests own their content rather than reading the real (shared) wiki.
let DIR: string;
const FIXTURES: Record<string, string> = {
  'Phenomena/Stillness.md': '---\ntitle: Stillness\n---\n', // frontmatter only → empty body
  'Geography/Calaria/index.md': '---\ntitle: Calaria\n---\nA coastal city with a busy harbor.\n',
  'Divinity/Divine Raiment.md': 'The raiment of the divine, woven from light.\n',
  'Divinity/Celestial Prescence.md': 'A presence that fills the firmament.\n',
};

beforeAll(async () => {
  DIR = `/tmp/heartwood-summarize-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (const [rel, content] of Object.entries(FIXTURES)) {
    const full = join(DIR, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
});

afterAll(async () => {
  await rm(DIR, { recursive: true, force: true });
});

function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    path: 'Geography/Calaria/index.md',
    title: 'Calaria',
    aliases: [],
    tags: [],
    img: null,
    headings: [],
    wikilinks: [],
    contentHash: 'abc123',
    byteLength: 42,
    summary: null,
    keyFacts: null,
    entities: null,
    ...overrides,
  };
}

const FAKE_RESULT: SummarizeResult = {
  summary: 'A coastal city.',
  keyFacts: ['Has a harbor', 'Home to the Choral Order'],
  entities: { people: [], places: ['Harbor'], orgs: ['Choral Order'] },
};

const fakeFn = async (_args: unknown) => ({ text: '', usage: {} as never, value: FAKE_RESULT });

test('summarizePage returns placeholder for empty body', async () => {
  const stubPage = makePage({ path: 'Phenomena/Stillness.md', title: 'Stillness', byteLength: 0 });
  const result = await summarizePage(stubPage, DIR, {
    model: 'claude-sonnet-4-6',
    completeFn: fakeFn as never,
  });
  expect(result.summary).toBe('(stub page — no content yet)');
  expect(result.keyFacts).toEqual([]);
  expect(result.entities).toEqual({ people: [], places: [], orgs: [] });
});

test('summarizePage calls completeFn for non-empty page', async () => {
  let called = false;
  const spy = async (args: Parameters<typeof fakeFn>[0] & { stage?: string; page?: string }) => {
    called = true;
    expect((args as { stage: string }).stage).toBe('summarize');
    expect((args as { page: string }).page).toBeTruthy();
    return { text: '', usage: {} as never, value: FAKE_RESULT };
  };
  const page = makePage({ path: 'Geography/Calaria/index.md', byteLength: 500 });
  await summarizePage(page, DIR, { model: 'claude-sonnet-4-6', completeFn: spy as never });
  expect(called).toBe(true);
});

test('summarizeWikiPages skips pages with non-null summary when not forced', async () => {
  let callCount = 0;
  const spy = async (_args: unknown) => {
    callCount++;
    return { text: '', usage: {} as never, value: FAKE_RESULT };
  };
  const pages = {
    'Divinity/Divine Raiment.md': makePage({ path: 'Divinity/Divine Raiment.md', summary: 'already done' }),
    'Divinity/Celestial Prescence.md': makePage({ path: 'Divinity/Celestial Prescence.md', summary: null }),
  };
  await summarizeWikiPages(pages, { contentDir: DIR, completeFn: spy as never });
  // only the null-summary page should be tried
  expect(callCount).toBeLessThanOrEqual(1);
});

test('summarizeWikiPages skips all when noLlm=true', async () => {
  let callCount = 0;
  const spy = async (_args: unknown) => {
    callCount++;
    return { text: '', usage: {} as never, value: FAKE_RESULT };
  };
  const pages = {
    'Geography/Calaria/index.md': makePage({ path: 'Geography/Calaria/index.md', summary: null }),
    'Divinity/Divine Raiment.md': makePage({ path: 'Divinity/Divine Raiment.md', summary: null }),
  };
  await summarizeWikiPages(pages, { contentDir: DIR, noLlm: true, completeFn: spy as never });
  expect(callCount).toBe(0);
});

test('summarizeWikiPages records failure and continues on error', async () => {
  let callCount = 0;
  const spy = async (_args: unknown) => {
    callCount++;
    if (callCount === 1) throw new Error('api flake');
    return { text: '', usage: {} as never, value: FAKE_RESULT };
  };
  const pages = {
    'Divinity/Celestial Prescence.md': makePage({ path: 'Divinity/Celestial Prescence.md', summary: null }),
    'Divinity/Divine Raiment.md': makePage({ path: 'Divinity/Divine Raiment.md', summary: null }),
  };
  const result = await summarizeWikiPages(pages, { contentDir: DIR, completeFn: spy as never });
  expect(result.failures.length).toBe(1);
  expect(Object.keys(result.enriched).length).toBe(1);
});

test('summarizeWikiPages force re-summarizes pages that already have a summary', async () => {
  let callCount = 0;
  const spy = async (_args: unknown) => {
    callCount++;
    return { text: '', usage: {} as never, value: FAKE_RESULT };
  };
  const pages = {
    'Geography/Calaria/index.md': makePage({ path: 'Geography/Calaria/index.md', summary: 'old summary' }),
  };
  await summarizeWikiPages(pages, { contentDir: DIR, force: true, completeFn: spy as never });
  expect(callCount).toBe(1);
});
