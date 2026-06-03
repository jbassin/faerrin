import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateProposal } from './validate';
import type { ValidateCtx } from './validate';
import type { Proposal, EditProposal, CreateProposal, AppendProposal, CommentProposal } from './propose';
import type { Segment } from '../transcript/segment';
import type { WikiIndex } from '../wiki/index-schema';

function makeSegments(overrides: Partial<Segment>[] = []): Segment[] {
  return overrides.map((s) => ({
    startLine: s.startLine ?? 1,
    endLine: s.endLine ?? 200,
    label: s.label ?? 'ic',
    confidence: s.confidence ?? 'high',
    oneLineSummary: s.oneLineSummary ?? 'play',
  }));
}

function makeWikiIndex(pages: Record<string, Partial<{
  path: string; title: string; aliases: string[]; tags: string[];
  headings: any[]; byteLength: number; contentHash: string;
}>> = {}): WikiIndex {
  const fullPages: WikiIndex['pages'] = {};
  for (const [path, p] of Object.entries(pages)) {
    fullPages[path] = {
      path,
      title: p.title ?? path.split('/').pop()!.replace('.md', ''),
      aliases: p.aliases ?? [],
      tags: p.tags ?? [],
      img: null,
      headings: p.headings ?? [],
      wikilinks: [],
      contentHash: 'abc',
      byteLength: p.byteLength ?? 100,
      summary: null,
      keyFacts: null,
      entities: null,
    };
  }
  return { generatedAt: '2026-01-01T00:00:00Z', pageCount: Object.keys(fullPages).length, pages: fullPages, unresolvedLinks: [] };
}

describe('citation validation', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Org'), { recursive: true });
    writeFileSync(join(dir, 'Org', 'Page.md'), 'Some old content here\nmore text\n');
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({ 'Org/Page.md': {} }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const makeEdit = (citations: [number, number][]): EditProposal => ({
    kind: 'edit',
    path: 'Org/Page.md',
    oldText: 'Some old content here',
    newText: 'Some new content here',
    citations,
  });

  test('citation in ic segment passes', async () => {
    const r = await validateProposal(makeEdit([[50, 60]]), ctx);
    expect(r.ok).toBe(true);
  });

  test('citation in recap segment passes', async () => {
    ctx.segments = makeSegments([{ startLine: 1, endLine: 500, label: 'recap' }]);
    const r = await validateProposal(makeEdit([[50, 60]]), ctx);
    expect(r.ok).toBe(true);
  });

  test('citation in mixed segment passes', async () => {
    ctx.segments = makeSegments([{ startLine: 1, endLine: 500, label: 'mixed' }]);
    const r = await validateProposal(makeEdit([[50, 60]]), ctx);
    expect(r.ok).toBe(true);
  });

  test('citation in ooc segment drops', async () => {
    ctx.segments = makeSegments([{ startLine: 1, endLine: 500, label: 'ooc' }]);
    const r = await validateProposal(makeEdit([[50, 60]]), ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/citation-not-in-extract-segment/);
  });

  test('citation in rules segment drops', async () => {
    ctx.segments = makeSegments([{ startLine: 1, endLine: 500, label: 'rules' }]);
    const r = await validateProposal(makeEdit([[50, 60]]), ctx);
    expect(r.ok).toBe(false);
  });

  test('citation spanning two segments where one is ic drops (must fully lie in one)', async () => {
    ctx.segments = makeSegments([
      { startLine: 1, endLine: 50, label: 'ic' },
      { startLine: 51, endLine: 200, label: 'ooc' },
    ]);
    // citation [45, 60] spans both ic (1-50) and ooc (51-200): no single segment covers it
    const r = await validateProposal(makeEdit([[45, 60]]), ctx);
    expect(r.ok).toBe(false);
  });
});

describe('edit oldText uniqueness', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Org'), { recursive: true });
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({ 'Org/Page.md': {} }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('oldText appears twice → dropped', async () => {
    writeFileSync(join(dir, 'Org', 'Page.md'), 'repeat repeat\n');
    const p: EditProposal = { kind: 'edit', path: 'Org/Page.md', oldText: 'repeat', newText: 'once', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('oldText-not-unique:count=2');
  });

  test('oldText appears zero times → dropped', async () => {
    writeFileSync(join(dir, 'Org', 'Page.md'), 'something else\n');
    const p: EditProposal = { kind: 'edit', path: 'Org/Page.md', oldText: 'not here', newText: 'x', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('oldText-not-unique:count=0');
  });

  test('oldText appears exactly once → passes', async () => {
    writeFileSync(join(dir, 'Org', 'Page.md'), 'unique phrase here\n');
    const p: EditProposal = { kind: 'edit', path: 'Org/Page.md', oldText: 'unique phrase', newText: 'common phrase', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(true);
  });

  test('edit target missing → dropped', async () => {
    const p: EditProposal = { kind: 'edit', path: 'Org/Nonexistent.md', oldText: 'x', newText: 'y', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('target-missing');
  });
});

describe('Rules/ exclusion', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Rules'), { recursive: true });
    writeFileSync(join(dir, 'Rules', 'Combat.md'), 'combat rules\n');
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({ 'Rules/Combat.md': {} }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('edit.path under Rules/ → dropped', async () => {
    const p: EditProposal = { kind: 'edit', path: 'Rules/Combat.md', oldText: 'combat', newText: 'melee', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('target-in-rules');
  });

  test('create.path under Rules/ → dropped', async () => {
    ctx.wikiIndex = makeWikiIndex({ 'Rules/Existing.md': {} });
    const p: CreateProposal = {
      kind: 'create', path: 'Rules/NewRule.md',
      content: '---\ntitle: New\n---\nContent.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('create-in-rules');
  });
});

describe('append validation', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Org'), { recursive: true });
    writeFileSync(join(dir, 'Org', 'Page.md'), '---\ntitle: Page\n---\n\n## History\n\nSome history.\n\n## Members\n\nSome members.\n');
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({ 'Org/Page.md': {} }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('afterHeading exists → passes', async () => {
    const p: AppendProposal = {
      kind: 'append', path: 'Org/Page.md',
      afterHeading: 'History',
      content: 'New paragraph.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(true);
  });

  test("afterHeading doesn't exist → dropped", async () => {
    const p: AppendProposal = {
      kind: 'append', path: 'Org/Page.md',
      afterHeading: 'Nonexistent Section',
      content: 'New paragraph.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/heading-not-found/);
  });

  test('afterHeading: null (EOF append) → passes regardless of headings', async () => {
    const p: AppendProposal = {
      kind: 'append', path: 'Org/Page.md',
      afterHeading: null,
      content: 'New section.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(true);
  });
});

describe('create validation', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Org', 'Iconoclasm', 'People'), { recursive: true });
    writeFileSync(join(dir, 'Org', 'Iconoclasm', 'People', 'Elias Ramsey.md'), '---\ntitle: Elias\n---\nContent.\n');
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({
        'Org/Iconoclasm/People/Elias Ramsey.md': {},
      }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const makCreate = (path: string, content = '---\ntitle: New\n---\nContent.'): CreateProposal => ({
    kind: 'create', path, content, citations: [[1, 1]],
  });

  test('fresh path under valid parent → passes', async () => {
    const r = await validateProposal(makCreate('Org/Iconoclasm/People/New Person.md'), ctx);
    expect(r.ok).toBe(true);
  });

  test('path already in wiki index → dropped', async () => {
    const r = await validateProposal(makCreate('Org/Iconoclasm/People/Elias Ramsey.md'), ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('path-already-exists');
  });

  test('parent directory missing → dropped', async () => {
    const r = await validateProposal(makCreate('New Folder/Page.md'), ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('parent-directory-missing');
  });

  test('invalid YAML frontmatter → dropped', async () => {
    const r = await validateProposal(makCreate('Org/Iconoclasm/People/Bad.md', '---\ntitle: [unclosed\n---\nContent.'), ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('frontmatter-invalid');
  });

  test('valid frontmatter → passes', async () => {
    const r = await validateProposal(makCreate('Org/Iconoclasm/People/Good.md', '---\ntitle: Good Person\naliases:\n  - Good\n---\nContent.'), ctx);
    expect(r.ok).toBe(true);
  });
});

describe('sibling frontmatter consistency', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Org', 'People'), { recursive: true });
    // 4 siblings all with 'title:' frontmatter
    for (const name of ['Alice.md', 'Bob.md', 'Carol.md', 'Dave.md']) {
      writeFileSync(join(dir, 'Org', 'People', name), `---\ntitle: ${name.replace('.md', '')}\n---\nContent.\n`);
    }
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({
        'Org/People/Alice.md': {},
        'Org/People/Bob.md': {},
        'Org/People/Carol.md': {},
        'Org/People/Dave.md': {},
      }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('4 siblings all have title:; new page lacks title: → dropped', async () => {
    const p: CreateProposal = {
      kind: 'create',
      path: 'Org/People/Eve.md',
      content: '---\naliases:\n  - Evie\n---\nContent.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/missing-frontmatter-keys/);
    expect((r as any).reason).toContain('title');
  });

  test('new page has title: → passes', async () => {
    const p: CreateProposal = {
      kind: 'create',
      path: 'Org/People/Eve.md',
      content: '---\ntitle: Eve\n---\nContent.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(true);
  });

  test('sibling consistency skipped with < 3 siblings', async () => {
    // Reduce to 2 siblings.
    ctx.wikiIndex = makeWikiIndex({
      'Org/People/Alice.md': {},
      'Org/People/Bob.md': {},
    });
    const p: CreateProposal = {
      kind: 'create',
      path: 'Org/People/Eve.md',
      content: '---\naliases:\n  - Evie\n---\nContent.',
      citations: [[1, 1]],
    };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(true);
  });
});

describe('frontmatter parsing after edit', () => {
  let dir: string;
  let ctx: ValidateCtx;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-'));
    mkdirSync(join(dir, 'Org'), { recursive: true });
    ctx = {
      contentDir: dir,
      segments: makeSegments([{ startLine: 1, endLine: 500, label: 'ic' }]),
      wikiIndex: makeWikiIndex({ 'Org/Page.md': {} }),
    };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('valid frontmatter after edit → passes', async () => {
    writeFileSync(join(dir, 'Org', 'Page.md'), '---\ntitle: Old\n---\nContent.\n');
    const p: EditProposal = { kind: 'edit', path: 'Org/Page.md', oldText: 'Old', newText: 'New', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(true);
  });

  test('invalid frontmatter after edit → dropped', async () => {
    writeFileSync(join(dir, 'Org', 'Page.md'), '---\ntitle: Old\n---\nContent.\n');
    // Replacing 'title: Old' with 'title: [broken:yaml' produces invalid YAML
    const p: EditProposal = { kind: 'edit', path: 'Org/Page.md', oldText: 'title: Old', newText: 'title: [broken:yaml', citations: [[1, 1]] };
    const r = await validateProposal(p, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('frontmatter-invalid-after-edit');
  });
});
