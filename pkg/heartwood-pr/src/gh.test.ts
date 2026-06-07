import { describe, expect, it } from 'bun:test';
import { FakeGh } from './gh';

// These tests validate the FakeGh test double is a faithful stand-in for the GhClient contract the
// bot steps rely on (create/view/comment/react/body-edit/merge). The real `gh` impl is the
// worldbuilder-gated boundary and is intentionally not exercised here (no network in tests).

describe('FakeGh contract', () => {
  it('creates an OPEN PR and reads it back', async () => {
    const gh = new FakeGh();
    const n = await gh.prCreate({ head: 'hw/arc-2025-08-28', base: 'main', title: 'T', body: 'B' });
    const view = await gh.prView(n);
    expect(view.state).toBe('OPEN');
    expect(view.body).toBe('B');
    expect(view.headRefName).toBe('hw/arc-2025-08-28');
    expect(view.mergedAt).toBeNull();
  });

  it('lists bot + reviewer comments oldest-first with author + stable id', async () => {
    const gh = new FakeGh();
    const n = await gh.prCreate({ head: 'h', base: 'main', title: 'T', body: 'B' });
    const botId = await gh.postComment(n, 'conflict here');
    const revId = gh.simulateComment(n, 'josh', '/keep');
    const comments = await gh.listComments(n);
    expect(comments.map((c) => c.id)).toEqual([botId, revId]);
    expect(comments[1]!.authorLogin).toBe('josh');
    expect(comments[1]!.body).toBe('/keep');
  });

  it('records reactions (the 👀→rocket ack)', async () => {
    const gh = new FakeGh();
    const n = await gh.prCreate({ head: 'h', base: 'main', title: 'T', body: 'B' });
    const id = gh.simulateComment(n, 'josh', '/replace');
    await gh.addReaction(id, 'eyes');
    await gh.addReaction(id, 'rocket');
    expect(gh.reactionsOn(id).sort()).toEqual(['eyes', 'rocket']);
  });

  it('reflects a reviewer body edit and a merge', async () => {
    const gh = new FakeGh();
    const n = await gh.prCreate({ head: 'h', base: 'main', title: 'T', body: 'orig' });
    gh.simulateBodyEdit(n, 'edited');
    expect((await gh.prView(n)).body).toBe('edited');
    gh.simulateMerge(n);
    const v = await gh.prView(n);
    expect(v.state).toBe('MERGED');
    expect(v.mergedAt).not.toBeNull();
  });

  it('prListByHead finds only OPEN PRs on that head (one-PR enforcement, AC-27a)', async () => {
    const gh = new FakeGh();
    const n1 = await gh.prCreate({ head: 'hw/x', base: 'main', title: 'T', body: 'B' });
    expect((await gh.prListByHead('hw/x')).map((p) => p.number)).toEqual([n1]);
    gh.simulateClose(n1);
    expect(await gh.prListByHead('hw/x')).toEqual([]);
  });

  it('throws on an unknown PR or comment', async () => {
    const gh = new FakeGh();
    expect(gh.prView(999)).rejects.toThrow('no such PR');
    expect(gh.addReaction('nope', 'eyes')).rejects.toThrow('no such comment');
  });
});
