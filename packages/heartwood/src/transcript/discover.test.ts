import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFilename, discoverTranscripts } from './discover';

test('parses a main-campaign filename', () => {
  const r = parseFilename('000.through-a-song-darkly.2025-10-20.txt');
  expect(r).toEqual({
    filename: '000.through-a-song-darkly.2025-10-20.txt',
    campaignId: 0,
    campaignName: 'through-a-song-darkly',
    sessionDate: '2025-10-20',
    isMain: true,
  });
});

test('parses a side-campaign filename (id >= 100)', () => {
  const r = parseFilename('101.interred-in-iomenei.2026-2-10.txt');
  expect(r?.campaignId).toBe(101);
  expect(r?.isMain).toBe(false);
  expect(r?.sessionDate).toBe('2026-02-10');
});

test('normalizes single-digit month/day to zero-padded ISO', () => {
  expect(parseFilename('000.foo.2025-8-28.txt')?.sessionDate).toBe('2025-08-28');
  expect(parseFilename('000.foo.2025-12-2.txt')?.sessionDate).toBe('2025-12-02');
  expect(parseFilename('000.foo.2025-12-30.txt')?.sessionDate).toBe('2025-12-30');
});

test('accepts multi-word hyphenated campaign names', () => {
  expect(parseFilename('103.a-hunt-of-metal-and-vine.2025-6-9.txt')?.campaignName)
    .toBe('a-hunt-of-metal-and-vine');
});

test('returns null for malformed filenames', () => {
  expect(parseFilename('readme.txt')).toBeNull();
  expect(parseFilename('000.no-date.txt')).toBeNull();
  expect(parseFilename('abc.thing.2025-1-1.txt')).toBeNull();   // non-numeric id
  expect(parseFilename('000.thing.2025-1-1.md')).toBeNull();    // wrong ext
});

test('discoverTranscripts walks a directory, hashes contents, and sorts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-'));
  try {
    writeFileSync(join(dir, '000.alpha.2025-8-28.txt'),  'AAA');
    writeFileSync(join(dir, '000.alpha.2025-12-2.txt'),  'BBB');
    writeFileSync(join(dir, '101.beta.2026-1-1.txt'),    'CCC');
    writeFileSync(join(dir, 'notes.txt'),                'skip me');
    const r = await discoverTranscripts(dir);
    expect(r.files.length).toBe(3);
    expect(r.skipped.length).toBe(1);
    expect(r.skipped[0]!.filename).toBe('notes.txt');
    // Sort: campaignId asc, then sessionDate asc (ISO-normalized, so 08-28 < 12-02)
    expect(r.files.map((f) => f.filename)).toEqual([
      '000.alpha.2025-8-28.txt',
      '000.alpha.2025-12-2.txt',
      '101.beta.2026-1-1.txt',
    ]);
    // Hash present and 64-hex
    for (const f of r.files) expect(f.contentHash).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discoverTranscripts against the real transcripts/ dir finds 37 files (26 main, 11 side)', async () => {
  const r = await discoverTranscripts('transcripts');
  expect(r.files.length).toBe(37);
  expect(r.files.filter((f) => f.isMain).length).toBe(26);
  expect(r.files.filter((f) => !f.isMain).length).toBe(11);
});
