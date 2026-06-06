import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPageProvenance,
  writePageProvenance,
  reanchorPage,
  addRecords,
  makeRecord,
  ProvenanceRecordSchema,
  type PageProvenance,
} from './provenance';
import { anchorForBody } from '../anchor/anchor';

const BODY = `Sableclutch is a poorer neighborhood. The district is somewhat overlooked by the rest of the capital.`;
const WIKI_PATH = 'Geography/Calaria/Hallia/Sableclutch/index.md';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hw-prov-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function recordFor(index: number) {
  return makeRecord({
    anchor: anchorForBody(BODY, index),
    arc: 'through-a-song-darkly',
    date: '2025-08-28',
    citations: [{ transcript: '000.through-a-song-darkly.2025-8-28.txt', start: 2587, end: 2590 }],
    claimId: 'claim-1',
    entityIds: ['ent:sableclutch'],
    approvedAt: '2026-06-06T00:00:00.000Z',
  });
}

test('reading a missing sidecar returns an empty record set', async () => {
  const prov = await readPageProvenance(root, WIKI_PATH);
  expect(prov).toEqual({ wikiPath: WIKI_PATH, records: [] });
});

test('write then read round-trips and tags the originating arc', async () => {
  const prov: PageProvenance = addRecords({ wikiPath: WIKI_PATH, records: [] }, [recordFor(1)]);
  await writePageProvenance(root, prov);
  const back = await readPageProvenance(root, WIKI_PATH);
  expect(back.records).toHaveLength(1);
  expect(back.records[0]!.arc).toBe('through-a-song-darkly');
  expect(back.records[0]!.session).toEqual({ arc: 'through-a-song-darkly', date: '2025-08-28' });
});

test('Zod rejects a record with no citations', () => {
  const bad = { ...recordFor(1), citations: [] };
  expect(() => ProvenanceRecordSchema.parse(bad)).toThrow();
});

test('reanchorPage keeps records on an unchanged body with no change', () => {
  const prov: PageProvenance = { wikiPath: WIKI_PATH, records: [recordFor(1)] };
  const r = reanchorPage(prov, BODY);
  expect(r.changed).toBe(false);
  expect(r.live).toHaveLength(1);
  expect(r.stale).toHaveLength(0);
});

test('reanchorPage updates the anchor when the sentence is lightly reworded', () => {
  const prov: PageProvenance = { wikiPath: WIKI_PATH, records: [recordFor(1)] };
  const edited = BODY.replace(
    'The district is somewhat overlooked by the rest of the capital.',
    'The district is somewhat overlooked by the rest of the capital these days.',
  );
  const r = reanchorPage(prov, edited);
  expect(r.changed).toBe(true);
  expect(r.live).toHaveLength(1);
  expect(r.live[0]!.anchor.normHash).not.toBe(prov.records[0]!.anchor.normHash);
});

test('reanchorPage marks a record stale when its sentence is deleted', () => {
  const prov: PageProvenance = { wikiPath: WIKI_PATH, records: [recordFor(1)] };
  const edited = 'Sableclutch is a poorer neighborhood.';
  const r = reanchorPage(prov, edited);
  expect(r.changed).toBe(true);
  expect(r.live).toHaveLength(0);
  expect(r.stale).toHaveLength(1);
});
