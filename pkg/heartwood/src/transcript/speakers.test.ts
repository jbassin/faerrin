import { test, expect } from 'bun:test';
import { parseSpeakers, speakersInRange, gmPresent } from './speakers';

function lines(...entries: [number, string][]): string {
  return entries.map(([n, s]) => `${String(n).padStart(6, '0')}\t${s}: hello`).join('\n');
}

test('parseSpeakers returns correct speaker names and 1-based line numbers', () => {
  const text = [
    '000001\tGamemaster: How are we?',
    '000002\tArgyle: Can you hear me?',
    '000003\tJohnny: Yeah.',
  ].join('\n');
  expect(parseSpeakers(text)).toEqual([
    { line: 1, speaker: 'Gamemaster' },
    { line: 2, speaker: 'Argyle' },
    { line: 3, speaker: 'Johnny' },
  ]);
});

test('parseSpeakers skips blank lines without crashing', () => {
  const text = [
    '000001\tGamemaster: Hello.',
    '',
    '000003\tArgyle: Hi.',
  ].join('\n');
  const result = parseSpeakers(text);
  expect(result).toHaveLength(2);
  expect(result[0]!.line).toBe(1);
  expect(result[1]!.line).toBe(3);
});

test('parseSpeakers skips lines with no tab-colon prefix', () => {
  const text = [
    '000001\tGamemaster: Hello.',
    'not a valid line',
    '000003\tArgyle: Hi.',
  ].join('\n');
  expect(parseSpeakers(text)).toHaveLength(2);
});

test('parseSpeakers handles trailing newline correctly', () => {
  const text = '000001\tGamemaster: Hi.\n000002\tArgyle: Hey.\n';
  const result = parseSpeakers(text);
  expect(result).toHaveLength(2);
  expect(result[1]!.line).toBe(2);
});

test('parseSpeakers preserves multi-word speaker names', () => {
  const text = '000001\tKiller Instinct: Hello.';
  expect(parseSpeakers(text)).toEqual([{ line: 1, speaker: 'Killer Instinct' }]);
});

test('speakersInRange returns only speakers within the range', () => {
  const sl = [
    { line: 1, speaker: 'Gamemaster' },
    { line: 5, speaker: 'Argyle' },
    { line: 10, speaker: 'Johnny' },
    { line: 15, speaker: 'Gamemaster' },
  ];
  const s = speakersInRange(sl, 4, 11);
  expect(s).toEqual(new Set(['Argyle', 'Johnny']));
});

test('speakersInRange is inclusive on both bounds', () => {
  const sl = [
    { line: 5, speaker: 'A' },
    { line: 10, speaker: 'B' },
  ];
  expect(speakersInRange(sl, 5, 10)).toEqual(new Set(['A', 'B']));
  expect(speakersInRange(sl, 5, 9)).toEqual(new Set(['A']));
  expect(speakersInRange(sl, 6, 10)).toEqual(new Set(['B']));
});

test('speakersInRange returns empty set when range is empty', () => {
  const sl = [{ line: 5, speaker: 'A' }];
  expect(speakersInRange(sl, 1, 4)).toEqual(new Set());
});

test('gmPresent returns true when Gamemaster is in range', () => {
  const sl = [
    { line: 1, speaker: 'Gamemaster' },
    { line: 2, speaker: 'Argyle' },
  ];
  expect(gmPresent(sl, 1, 5)).toBe(true);
});

test('gmPresent returns false when Gamemaster is not in range', () => {
  const sl = [
    { line: 1, speaker: 'Gamemaster' },
    { line: 2, speaker: 'Argyle' },
  ];
  expect(gmPresent(sl, 2, 5)).toBe(false);
});

test('gmPresent returns false for an empty transcript', () => {
  expect(gmPresent([], 1, 10)).toBe(false);
});
