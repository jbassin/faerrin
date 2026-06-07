import { describe, expect, it } from 'bun:test';
import { FakeJj } from './jj';

// Validates FakeJj is a faithful JjClient double for the bot's branch logic. The real jj impl is the
// gated boundary (no repo mutation / remote in tests).

describe('FakeJj contract', () => {
  it('sets a bookmark and reads its target', async () => {
    const jj = new FakeJj();
    await jj.bookmarkSet('hw/arc-2025-08-28', 'rev1');
    expect(await jj.bookmarkTarget('hw/arc-2025-08-28')).toBe('rev1');
    expect(await jj.bookmarkTarget('nope')).toBeNull();
  });

  it('records additive pushes at the current bookmark target', async () => {
    const jj = new FakeJj();
    await jj.bookmarkSet('hw/x', 'rev1');
    await jj.gitPush('hw/x');
    await jj.bookmarkSet('hw/x', 'rev2'); // a redraft moves the bookmark forward
    await jj.gitPush('hw/x');
    expect(jj.pushes).toEqual([
      { bookmark: 'hw/x', target: 'rev1' },
      { bookmark: 'hw/x', target: 'rev2' },
    ]);
  });

  it('refuses to push an unknown bookmark', async () => {
    const jj = new FakeJj();
    expect(jj.gitPush('hw/ghost')).rejects.toThrow('unknown bookmark');
  });

  it('simulateHumanCommit moves the target off what the bot pushed (AC-10 discriminator)', async () => {
    const jj = new FakeJj();
    await jj.bookmarkSet('hw/x', 'bot-rev');
    await jj.gitPush('hw/x');
    jj.simulateHumanCommit('hw/x', 'human-rev');
    // the live target now differs from the last target the bot pushed
    expect(await jj.bookmarkTarget('hw/x')).toBe('human-rev');
    expect(jj.pushes.at(-1)!.target).toBe('bot-rev');
  });

  it('tracks fetch / delete / abandon for the canonizer', async () => {
    const jj = new FakeJj();
    await jj.bookmarkSet('hw/x', 'rev1');
    await jj.gitFetch();
    await jj.bookmarkDelete('hw/x');
    await jj.abandon('hw/x-revs');
    expect(jj.fetches.length).toBe(1);
    expect(jj.deleted).toEqual(['hw/x']);
    expect(jj.abandoned).toEqual(['hw/x-revs']);
    expect(await jj.bookmarkTarget('hw/x')).toBeNull();
  });
});
