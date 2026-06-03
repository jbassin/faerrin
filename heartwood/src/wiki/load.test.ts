import { test, expect } from 'bun:test';
import { loadWikiIndex, mergeIndex } from './load';

const CONTENT_DIR = 'content';

test('indexes every .md file under content/', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const glob = new Bun.Glob('**/*.md');
  let onDisk = 0;
  for await (const _ of glob.scan({ cwd: CONTENT_DIR })) onDisk += 1;
  expect(index.pageCount).toBe(onDisk);
  expect(Object.keys(index.pages).length).toBe(onDisk);
});

test('every wikilink is either resolved or in unresolvedLinks', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const page of Object.values(index.pages)) {
    for (const link of page.wikilinks) {
      if (link.resolvedPath === null) {
        const found = index.unresolvedLinks.some(
          (u) => u.sourcePath === page.path && u.raw === link.raw,
        );
        expect(found).toBe(true);
      } else {
        expect(index.pages[link.resolvedPath]).toBeDefined();
      }
    }
  }
});

test('aliases round-trip: every alias resolves back to a page', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const aliasMap = new Map<string, string>();
  for (const page of Object.values(index.pages)) {
    for (const alias of page.aliases) {
      if (!aliasMap.has(alias)) aliasMap.set(alias, page.path);
    }
  }
  for (const page of Object.values(index.pages)) {
    for (const alias of page.aliases) {
      const target = aliasMap.get(alias);
      expect(target).toBeDefined();
      expect(index.pages[target!]).toBeDefined();
    }
  }
});

test('special-character filenames are present and resolvable', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const p of [
    'Geography/Færrin.md',
    'Geography/Tormeré/index.md',
    'Geography/Rhædon/index.md',
    'Org/Ætherion Limited.md',
  ]) {
    expect(index.pages[p]).toBeDefined();
  }
});

test('contentHash and byteLength are populated; summary, keyFacts, entities are null', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  for (const page of Object.values(index.pages)) {
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(page.byteLength).toBeGreaterThanOrEqual(0);
    expect(page.summary).toBeNull();
    expect(page.keyFacts).toBeNull();
    expect(page.entities).toBeNull();
  }
});

test('mergeIndex carries forward summary for unchanged pages', async () => {
  const fresh = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const [firstPath, firstPage] = Object.entries(fresh.pages)[0]!;
  const ondisk = {
    ...fresh,
    pages: {
      ...fresh.pages,
      [firstPath]: { ...firstPage, summary: 'test summary', keyFacts: ['fact1'], entities: { people: [], places: [], orgs: [] } },
    },
  };
  const merged = mergeIndex(fresh, ondisk);
  expect(merged.pages[firstPath]!.summary).toBe('test summary');
  expect(merged.pages[firstPath]!.keyFacts).toEqual(['fact1']);
  expect(merged.pages[firstPath]!.entities).toEqual({ people: [], places: [], orgs: [] });
});

test('mergeIndex does not carry forward summary when contentHash differs', async () => {
  const fresh = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const [firstPath, firstPage] = Object.entries(fresh.pages)[0]!;
  const ondisk = {
    ...fresh,
    pages: {
      ...fresh.pages,
      [firstPath]: { ...firstPage, contentHash: 'different-hash', summary: 'stale summary' },
    },
  };
  const merged = mergeIndex(fresh, ondisk);
  expect(merged.pages[firstPath]!.summary).toBeNull();
});

test('title derivation: index.md uses parent directory name', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const calaria = index.pages['Geography/Calaria/index.md'];
  expect(calaria).toBeDefined();
  expect(calaria!.title).toBe('Calaria');
});

test('title derivation: leaf page without frontmatter uses filename', async () => {
  const index = await loadWikiIndex({ contentDir: CONTENT_DIR });
  const firmament = index.pages['Phenomena/Firmament.md'];
  expect(firmament).toBeDefined();
  expect(firmament!.title).toBe('Firmament');
});
