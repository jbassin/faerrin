import { test, expect } from 'bun:test';
import { filterByWorthiness, type WorthinessResult } from './worthiness';
import type { Claim } from './extract';
import type { complete } from '../llm';

function makeClaim(text: string, lineStart = 1, lineEnd = 1): Claim {
  return {
    claim:                  text,
    lines:                  [lineStart, lineEnd],
    speaker:                'Gamemaster',
    role:                   'gm',
    confidence:             'stated',
    entities:               [],
    sourceSegmentStartLine: lineStart,
  };
}

// Build a fake completeFn that returns verdicts based on a provided map.
function makeFakeComplete(verdicts: Record<number, 'wiki' | 'transcript'>): typeof complete {
  return (async (args: any) => {
    const entries = Object.entries(verdicts).map(([i, v]) => ({ index: Number(i), verdict: v }));
    return {
      text:  '',
      usage: {} as never,
      value: { verdicts: entries },
    };
  }) as never;
}

test('filterByWorthiness keeps wiki claims and drops transcript claims', async () => {
  const claims = [
    makeClaim('Elias Ramsey is the chief archivist of the Grand Library', 1, 1),
    makeClaim('Benny placed the report on the table', 2, 2),
    makeClaim('Thornwall is a walled trade city at the base of the Ashen Mountains', 3, 3),
    makeClaim('The party walked into the tavern', 4, 4),
    makeClaim('The Embercall faction controls the southern docks', 5, 5),
  ];
  // 0,2,4 are wiki; 1,3 are transcript
  const fake = makeFakeComplete({ 0: 'wiki', 1: 'transcript', 2: 'wiki', 3: 'transcript', 4: 'wiki' });

  const result = await filterByWorthiness(claims, {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });

  expect(result.kept).toHaveLength(3);
  expect(result.dropped).toHaveLength(2);
  expect(result.kept.map((c) => c.claim)).toContain('Elias Ramsey is the chief archivist of the Grand Library');
  expect(result.kept.map((c) => c.claim)).toContain('Thornwall is a walled trade city at the base of the Ashen Mountains');
  expect(result.dropped.map((c) => c.claim)).toContain('Benny placed the report on the table');
  expect(result.dropped.map((c) => c.claim)).toContain('The party walked into the tavern');
});

test('filterByWorthiness returns empty arrays for empty input', async () => {
  const fake: typeof complete = (async () => {
    throw new Error('should not be called');
  }) as never;

  const result = await filterByWorthiness([], {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });
  expect(result.kept).toHaveLength(0);
  expect(result.dropped).toHaveLength(0);
});

test('filterByWorthiness defaults to keep when verdict is missing for an index', async () => {
  const claims = [makeClaim('Some claim', 1, 1)];
  // Return verdicts with no entry for index 0
  const fake: typeof complete = (async () => ({
    text: '', usage: {} as never, value: { verdicts: [] },
  })) as never;

  const result = await filterByWorthiness(claims, {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });
  expect(result.kept).toHaveLength(1);
  expect(result.dropped).toHaveLength(0);
});

test('filterByWorthiness batches large claim sets (verifies multi-batch)', async () => {
  // 25 claims → 2 batches (20 + 5). First batch: all wiki. Second batch: all transcript.
  const claims = Array.from({ length: 25 }, (_, i) => makeClaim(`claim ${i}`, i + 1, i + 1));
  let batchCount = 0;
  const fake: typeof complete = (async (args: any) => {
    batchCount++;
    const lines: string[] = (args.user as string).split('\n');
    const verdicts = lines.map((line) => {
      const idx = Number(line.split(':')[0]!.trim());
      // First batch (20 claims): wiki. Second batch (5 claims): transcript.
      return { index: idx, verdict: batchCount === 1 ? 'wiki' as const : 'transcript' as const };
    });
    return { text: '', usage: {} as never, value: { verdicts } };
  }) as never;

  const result = await filterByWorthiness(claims, {
    model: 'm', transcript: 't.txt', completeFn: fake,
  });

  expect(batchCount).toBe(2);
  expect(result.kept).toHaveLength(20);
  expect(result.dropped).toHaveLength(5);
});

test('filterByWorthiness passes stage and transcript to completeFn', async () => {
  let captured: any = null;
  const fake: typeof complete = (async (args: any) => {
    captured = args;
    return { text: '', usage: {} as never, value: { verdicts: [{ index: 0, verdict: 'wiki' }] } };
  }) as never;

  await filterByWorthiness([makeClaim('A claim', 1, 1)], {
    model: 'test-model', transcript: 'foo.txt', completeFn: fake,
  });

  expect(captured.stage).toBe('filter');
  expect(captured.transcript).toBe('foo.txt');
  expect(captured.model).toBe('test-model');
  expect(typeof captured.cached).toBe('string');
  expect(captured.cached).toContain('wiki-worthiness classifier');
});
