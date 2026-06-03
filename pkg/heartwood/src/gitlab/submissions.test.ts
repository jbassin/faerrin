import { test, expect, describe } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { readSubmissions, writeSubmissions, type SubmissionsFile } from './submissions';

async function makeTmpDir(): Promise<string> {
  const dir = `/tmp/heartwood-submissions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('readSubmissions', () => {
  test('returns null when file does not exist', async () => {
    const dir = await makeTmpDir();
    const result = await readSubmissions(`${dir}/nonexistent.json`);
    expect(result).toBeNull();
  });
});

describe('writeSubmissions / readSubmissions round-trip', () => {
  test('writes and reads back correctly', async () => {
    const dir = await makeTmpDir();
    const path = `${dir}/000.test.2025-1-1.json`;
    const data: SubmissionsFile = {
      filename:    '000.test.2025-1-1.txt',
      mrIid:       42,
      branch:      'wiki/000.test.2025-1-1',
      discussions: [
        { discussionId: 'abc123', proposalIndex: 0 },
        { discussionId: 'def456', proposalIndex: 2 },
      ],
    };

    await writeSubmissions(path, data);
    const back = await readSubmissions(path);
    expect(back).toEqual(data);
  });

  test('file is pretty-printed JSON', async () => {
    const dir = await makeTmpDir();
    const path = `${dir}/pretty.json`;
    await writeSubmissions(path, {
      filename: 'a.txt', mrIid: 1, branch: 'wiki/a', discussions: [],
    });
    const raw = await Bun.file(path).text();
    expect(raw).toContain('\n');
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('schema rejects invalid data (negative mrIid)', async () => {
    const dir = await makeTmpDir();
    const path = `${dir}/bad.json`;
    await Bun.write(path, JSON.stringify({ filename: 'a.txt', mrIid: -1, branch: 'wiki/a', discussions: [] }));
    await expect(readSubmissions(path)).rejects.toThrow();
  });
});
