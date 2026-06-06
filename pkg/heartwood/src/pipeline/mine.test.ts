import { test, expect } from 'bun:test';
import { mine, MineChunkSchema, type MineCompleteFn } from './mine';
import type { CompleteResult } from '../llm';
import type { z } from 'zod';

type Facts = z.infer<typeof MineChunkSchema>['facts'];

// A transcript long enough to be one window, with speaker prefixes for attribution.
function transcript(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 50; i++) {
    const n = String(i).padStart(6, '0');
    const speaker = i % 5 === 0 ? 'Gamemaster' : 'Johnny';
    lines.push(`${n}\t${speaker}: line ${i} content`);
  }
  return lines.join('\n');
}

function stub(facts: Facts): MineCompleteFn {
  return async () =>
    ({
      text: '',
      usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, ms: 0 },
      value: { facts },
    }) as CompleteResult<typeof MineChunkSchema>;
}

test('maps mined facts to cited, modality-tagged claims', async () => {
  const res = await mine(transcript(), {
    transcriptName: 't.txt',
    model: 'test',
    completeFn: stub([
      { statement: 'Iomenei is a six-legged Strider City.', entities: ['Iomenei'], startLine: 10, endLine: 12, modality: 'gm-stated' },
    ]),
  });
  expect(res.claims).toHaveLength(1);
  const c = res.claims[0]!;
  expect(c.text).toBe('Iomenei is a six-legged Strider City.');
  expect(c.citations).toEqual([{ transcript: 't.txt', start: 10, end: 12 }]);
  expect(c.modality).toBe('gm-stated');
  expect(c.entitySurfaceForms).toEqual(['Iomenei']);
  expect(c.role).toBe('gm'); // line 10 speaker is Gamemaster
  expect(c.speaker).toBe('Gamemaster');
});

test('attributes a player line to role player', async () => {
  const res = await mine(transcript(), {
    transcriptName: 't.txt',
    model: 'test',
    completeFn: stub([
      { statement: 'A fact from a player line.', entities: ['Thing'], startLine: 7, endLine: 7, modality: 'player-speculation' },
    ]),
  });
  expect(res.claims[0]!.role).toBe('player');
  expect(res.claims[0]!.speaker).toBe('Johnny');
});

test('drops facts with no entities (nowhere to live in the wiki)', async () => {
  const res = await mine(transcript(), {
    transcriptName: 't.txt',
    model: 'test',
    completeFn: stub([
      { statement: 'A fact with a home.', entities: ['Iomenei'], startLine: 5, endLine: 5, modality: 'gm-stated' },
      { statement: 'A homeless fact.', entities: [], startLine: 6, endLine: 6, modality: 'gm-stated' },
    ]),
  });
  expect(res.claims).toHaveLength(1);
  expect(res.droppedNoEntity).toBe(1);
  expect(res.claims[0]!.text).toBe('A fact with a home.');
});

test('dedupes repeated facts (overlap windows) by normalized statement', async () => {
  const res = await mine(transcript(), {
    transcriptName: 't.txt',
    model: 'test',
    completeFn: stub([
      { statement: 'The Undercroft houses many crofters.', entities: ['Undercroft'], startLine: 3, endLine: 4, modality: 'gm-stated' },
      { statement: 'The  Undercroft houses many crofters.', entities: ['Undercroft'], startLine: 20, endLine: 21, modality: 'gm-stated' },
    ]),
  });
  expect(res.rawCount).toBe(2);
  expect(res.claims).toHaveLength(1);
});

test('claims carry sequential ids', async () => {
  const res = await mine(transcript(), {
    transcriptName: 't.txt',
    model: 'test',
    completeFn: stub([
      { statement: 'Fact one.', entities: ['A'], startLine: 1, endLine: 1, modality: 'gm-stated' },
      { statement: 'Fact two.', entities: ['B'], startLine: 2, endLine: 2, modality: 'uncertain' },
    ]),
  });
  expect(res.claims.map((c) => c.id)).toEqual(['c001', 'c002']);
});
