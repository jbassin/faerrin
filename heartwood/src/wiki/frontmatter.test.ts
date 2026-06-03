import { test, expect } from 'bun:test';
import { parseFrontmatter } from './frontmatter';

test('no frontmatter → empty data, full body', () => {
  const { data, body } = parseFrontmatter('# hello\nbody');
  expect(data).toEqual({});
  expect(body).toBe('# hello\nbody');
});

test('frontmatter with scalar and array', () => {
  const text = '---\ntitle: Foo\naliases:\n  - F\n  - Foozle\ntags: [a, b]\n---\nbody here';
  const { data, body } = parseFrontmatter(text);
  expect(data).toEqual({ title: 'Foo', aliases: ['F', 'Foozle'], tags: ['a', 'b'] });
  expect(body).toBe('body here');
});

test('CRLF line endings', () => {
  const text = '---\r\ntitle: Foo\r\n---\r\nbody';
  expect(parseFrontmatter(text).data).toEqual({ title: 'Foo' });
});

test('unterminated frontmatter → whole file is body', () => {
  const text = '---\ntitle: Foo\nbody no close';
  const { data, body } = parseFrontmatter(text);
  expect(data).toEqual({});
  expect(body).toBe(text);
});

test('malformed YAML throws with path in message', () => {
  expect(() => parseFrontmatter('---\ntitle: [unclosed\n---\n', 'bad.md'))
    .toThrow(/bad\.md/);
});

test('empty frontmatter block', () => {
  const text = '---\n---\nbody';
  const { data, body } = parseFrontmatter(text);
  expect(data).toEqual({});
  expect(body).toBe('body');
});
