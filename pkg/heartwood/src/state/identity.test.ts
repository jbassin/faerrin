import { test, expect } from 'bun:test';
import { sessionIdFromFilename, sessionKey, sessionIdEquals } from './identity';

test('parses (arc, date) from a transcript filename', () => {
  const id = sessionIdFromFilename('000.through-a-song-darkly.2025-8-28.txt');
  expect(id).toEqual({ arc: 'through-a-song-darkly', date: '2025-08-28' });
});

test('returns null for a non-conforming filename', () => {
  expect(sessionIdFromFilename('notes.txt')).toBeNull();
});

test('the arc basename is not a unique key — two 000 sessions differ only by date', () => {
  const a = sessionIdFromFilename('000.through-a-song-darkly.2025-8-28.txt')!;
  const b = sessionIdFromFilename('000.through-a-song-darkly.2026-1-20.txt')!;
  expect(a.arc).toBe(b.arc);
  expect(sessionKey(a)).not.toBe(sessionKey(b));
  expect(sessionIdEquals(a, b)).toBe(false);
});

test('sessionKey is stable and arc@date shaped', () => {
  expect(sessionKey({ arc: 'fae-and-forest', date: '2025-09-18' })).toBe('fae-and-forest@2025-09-18');
});
