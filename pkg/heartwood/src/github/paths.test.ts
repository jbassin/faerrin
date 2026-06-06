import { test, expect } from 'bun:test';
import { WIKI_REPO_DIR, toRepoPath, fromRepoPath } from './paths';

test('the wiki lives under pkg/content/wiki in the monorepo repo, not the old content/ root', () => {
  expect(WIKI_REPO_DIR).toBe('pkg/content/wiki');
});

test('toRepoPath prefixes a wiki-relative page path with the repo wiki dir', () => {
  expect(toRepoPath('Org/Iconoclasm/People/Illmari Vaino.md')).toBe(
    'pkg/content/wiki/Org/Iconoclasm/People/Illmari Vaino.md',
  );
});

test('fromRepoPath is the inverse of toRepoPath', () => {
  const p = 'Geography/Hallia/index.md';
  expect(fromRepoPath(toRepoPath(p))).toBe(p);
});

test('fromRepoPath leaves an already-stripped path unchanged', () => {
  expect(fromRepoPath('Geography/Hallia/index.md')).toBe('Geography/Hallia/index.md');
});

test('fromRepoPath does not strip the bare legacy content/ prefix (it is no longer the repo root)', () => {
  // A path the old code would have produced; it is not under WIKI_REPO_DIR, so it
  // is returned verbatim rather than mis-stripped.
  expect(fromRepoPath('content/Foo.md')).toBe('content/Foo.md');
});
