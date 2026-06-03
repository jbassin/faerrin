import { test, expect } from 'bun:test';
import { chunkTranscript } from './chunk';

function makeLines(n: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(`${String(i).padStart(6, '0')}\tSpeaker: line ${i}`);
  }
  return out.join('\n');
}

test('splits into overlapping windows with correct line ranges', () => {
  const text = makeLines(25);
  const r = chunkTranscript(text, { windowLines: 10, overlapLines: 2 });
  expect(r.totalLines).toBe(25);
  expect(r.windows.map((w) => [w.startLine, w.endLine])).toEqual([
    [1, 10],
    [9, 18],
    [17, 25],
  ]);
  expect(r.windows.map((w) => w.index)).toEqual([0, 1, 2]);
});

test('last window ends exactly at totalLines (no padding past end)', () => {
  const text = makeLines(25);
  const r = chunkTranscript(text, { windowLines: 10, overlapLines: 2 });
  expect(r.windows[r.windows.length - 1]!.endLine).toBe(25);
});

test('returns a single window when input is shorter than windowLines', () => {
  const text = makeLines(5);
  const r = chunkTranscript(text); // defaults: 400/40
  expect(r.totalLines).toBe(5);
  expect(r.windows).toHaveLength(1);
  expect(r.windows[0]).toMatchObject({ index: 0, startLine: 1, endLine: 5 });
});

test('returns no windows for empty input', () => {
  expect(chunkTranscript('')).toEqual({ totalLines: 0, windows: [] });
});

test('ignores a single trailing newline so totalLines is the human count', () => {
  const text = makeLines(3) + '\n';
  const r = chunkTranscript(text);
  expect(r.totalLines).toBe(3);
  expect(r.windows[0]!.endLine).toBe(3);
});

test('window text contains the prefixed lines for its range', () => {
  const text = makeLines(25);
  const r = chunkTranscript(text, { windowLines: 10, overlapLines: 2 });
  const w1 = r.windows[1]!; // [9-18]
  const lines = w1.text.split('\n');
  expect(lines).toHaveLength(10);
  expect(lines[0]).toBe('000009\tSpeaker: line 9');
  expect(lines[lines.length - 1]).toBe('000018\tSpeaker: line 18');
});

test('throws when overlapLines >= windowLines', () => {
  expect(() => chunkTranscript('foo', { windowLines: 10, overlapLines: 10 })).toThrow();
  expect(() => chunkTranscript('foo', { windowLines: 5, overlapLines: 7 })).toThrow();
});

test('throws when windowLines is not positive', () => {
  expect(() => chunkTranscript('foo', { windowLines: 0 })).toThrow();
  expect(() => chunkTranscript('foo', { windowLines: -1 })).toThrow();
});

test('throws when overlapLines is negative', () => {
  expect(() => chunkTranscript('foo', { windowLines: 10, overlapLines: -1 })).toThrow();
});

test('zero overlap produces non-overlapping windows', () => {
  const text = makeLines(10);
  const r = chunkTranscript(text, { windowLines: 4, overlapLines: 0 });
  expect(r.windows.map((w) => [w.startLine, w.endLine])).toEqual([
    [1, 4],
    [5, 8],
    [9, 10],
  ]);
});
