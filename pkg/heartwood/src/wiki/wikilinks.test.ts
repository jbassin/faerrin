import { test, expect } from 'bun:test';
import { extractWikilinks, extractHeadings } from './wikilinks';

test('bare wikilink', () => {
  const links = extractWikilinks('see [[Foo]] for more');
  expect(links).toEqual([{ raw: '[[Foo]]', target: 'Foo' }]);
});

test('wikilink with display', () => {
  const links = extractWikilinks('see [[Foo Bar|that page]]');
  expect(links[0]).toMatchObject({ target: 'Foo Bar', display: 'that page' });
});

test('path-form wikilink with display', () => {
  const links = extractWikilinks('cf [[Geography/Calaria/Hallia/index|Hallia]]');
  expect(links[0]).toMatchObject({
    target: 'Geography/Calaria/Hallia/index',
    display: 'Hallia',
  });
});

test('wikilink with #section', () => {
  const links = extractWikilinks('[[Foo#Bar]] and [[Foo#Bar|Bar]]');
  expect(links[0]).toMatchObject({ target: 'Foo', section: 'Bar' });
  expect(links[1]).toMatchObject({ target: 'Foo', section: 'Bar', display: 'Bar' });
});

test('wikilinks inside a callout', () => {
  const text = '> [!quote] Source\n> body [[Foo]] and [[Bar|baz]]';
  const links = extractWikilinks(text);
  expect(links.map((l) => l.target)).toEqual(['Foo', 'Bar']);
});

test('wikilinks inside frontmatter (regex over full file)', () => {
  const text = '---\naliases:\n  - "[[Other Page]]"\n---\nbody';
  const links = extractWikilinks(text);
  expect(links[0]).toMatchObject({ target: 'Other Page' });
});

test('special-character target', () => {
  const links = extractWikilinks('[[Færrin]] and [[Geography/Rhædon/index|Rhædon]]');
  expect(links[0]).toMatchObject({ target: 'Færrin' });
  expect(links[1]).toMatchObject({ target: 'Geography/Rhædon/index' });
});

test('multiple wikilinks on one line', () => {
  const links = extractWikilinks('[[A]] and [[B|bee]] and [[C/D/index|D]]');
  expect(links.map((l) => l.target)).toEqual(['A', 'B', 'C/D/index']);
});

test('no wikilinks returns empty array', () => {
  expect(extractWikilinks('plain text with no brackets')).toEqual([]);
});

test('extractHeadings only catches body headings, not list-prefixed text', () => {
  const headings = extractHeadings('# Top\n## Sub\n - # not a heading\nbody');
  expect(headings).toEqual([
    { level: 1, text: 'Top' },
    { level: 2, text: 'Sub' },
  ]);
});

test('extractHeadings all levels', () => {
  const body = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
  const headings = extractHeadings(body);
  expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
});

test('extractHeadings strips trailing whitespace', () => {
  const body = '## Section Title  ';
  const headings = extractHeadings(body);
  expect(headings[0]?.text).toBe('Section Title');
});
