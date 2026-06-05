import { test, expect, describe } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { writeDryRun } from './dry-run';
import type { CommitAction } from './client';
import type { DiscussionMapping } from './submissions';

async function makeTmpDir(): Promise<string> {
  const dir = `/tmp/heartwood-dryrun-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('writeDryRun', () => {
  test('creates directory and writes all four files', async () => {
    const dryRunsDir = await makeTmpDir();
    const actions: CommitAction[] = [
      { action: 'update', filePath: 'content/Foo/index.md', content: '# Foo\n' },
    ];
    const description = '## Summary\n\nSome content.';
    const notes = ['**[Speculative]** — first note', '**[Contradiction]** — second note'];
    const discussions: DiscussionMapping[] = [{ discussionId: 'disc-1', proposalIndex: 0 }];

    const out = await writeDryRun('my-transcript', actions, description, notes, discussions, dryRunsDir);

    expect(out.dryRunDir).toBe(`${dryRunsDir}/my-transcript`);
    expect(out.changesPath).toBe(`${dryRunsDir}/my-transcript/changes.json`);
    expect(out.descriptionPath).toBe(`${dryRunsDir}/my-transcript/pr-description.md`);
    expect(out.notesPath).toBe(`${dryRunsDir}/my-transcript/notes.json`);
    expect(out.discussionsPath).toBe(`${dryRunsDir}/my-transcript/discussions.json`);

    const changesRaw = await Bun.file(out.changesPath).text();
    expect(JSON.parse(changesRaw)).toEqual(actions);

    const descRaw = await Bun.file(out.descriptionPath).text();
    expect(descRaw).toBe(description);

    const notesRaw = await Bun.file(out.notesPath).text();
    expect(JSON.parse(notesRaw)).toEqual(notes);

    const discRaw = await Bun.file(out.discussionsPath).text();
    expect(JSON.parse(discRaw)).toEqual(discussions);
  });

  test('changes.json is pretty-printed', async () => {
    const dryRunsDir = await makeTmpDir();
    const actions: CommitAction[] = [
      { action: 'create', filePath: 'content/New.md', content: '# New\n' },
    ];
    const out = await writeDryRun('foo', actions, '', [], [], dryRunsDir);
    const raw = await Bun.file(out.changesPath).text();
    expect(raw).toContain('\n');
    expect(raw.endsWith('\n')).toBe(true);
  });
});
