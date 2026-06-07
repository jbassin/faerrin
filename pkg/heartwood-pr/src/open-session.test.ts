import { describe, expect, it } from 'bun:test';
import { acquireSurface } from '@faerrin/heartwood/src/state/review';
import { parseCheckboxStates, parseConflictMarker } from './markers';
import { openSession } from './open-session';
import { makeArtifact, makeConflict, makeHarness, makeProposal, SID } from './test-fixtures';

describe('openSession (NLSpec 0002 AC-1/4/7/27a)', () => {
  it('drafts every page, writes the branch, pushes, and opens a narrative-led PR', async () => {
    const artifact = makeArtifact({
      proposals: [makeProposal({ id: 'prop:a', canonicalName: 'Sableclutch' })],
    });
    const h = makeHarness({ artifact });
    const res = await openSession(SID, h.deps);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // branch written + pushed additively, at the writer's revision
    expect(h.writer.calls.length).toBe(1);
    expect(h.jj.pushes).toEqual([{ bookmark: 'hw/through-a-song-darkly-2025-08-28', target: h.writer.lastRevision }]);
    // PR body is narrative-led with the page as a checkbox
    expect(res.body).toContain('In-voice draft for Sableclutch');
    expect(parseCheckboxStates(res.body).get('prop:a')).toBe(true);
    // PR exists and is OPEN
    expect((await h.gh.prView(res.prNumber)).state).toBe('OPEN');
  });

  it('acquires the PR lock and persists linkage (prNumber, bookmark target, last-seen body)', async () => {
    const artifact = makeArtifact({ proposals: [makeProposal({ id: 'prop:a', canonicalName: 'A' })] });
    const h = makeHarness({ artifact });
    const res = await openSession(SID, h.deps);
    if (!res.ok) throw new Error('expected ok');

    const state = await h.ledger.read(SID);
    expect(state.reviewSurface?.surface).toBe('pr');
    expect(state.reviewSurface?.prNumber).toBe(res.prNumber);
    expect(state.reviewSurface?.lastBotBookmarkTarget).toBe(h.writer.lastRevision);
    expect(state.reviewSurface?.lastSeenPrBody).toBe(res.body);
  });

  it('posts one marker-bound conflict comment per conflict (AC-5)', async () => {
    const artifact = makeArtifact({
      proposals: [makeProposal({ id: 'prop:i', canonicalName: 'Iomenei', entityId: 'ent:iom' })],
      conflicts: [makeConflict({ claimId: 'prop:i:c1', entityId: 'ent:iom' })],
    });
    const h = makeHarness({ artifact });
    const res = await openSession(SID, h.deps);
    if (!res.ok) throw new Error('expected ok');

    const comments = await h.gh.listComments(res.prNumber);
    expect(comments.length).toBe(1);
    expect(parseConflictMarker(comments[0]!.body)).toBe('prop:i:c1');
    expect(comments[0]!.body).toContain('Canon conflict');
  });

  it('refuses a second PR for an open session (AC-27a)', async () => {
    const artifact = makeArtifact({ proposals: [makeProposal({ id: 'prop:a', canonicalName: 'A' })] });
    const h = makeHarness({ artifact });
    await openSession(SID, h.deps);
    const second = await openSession(SID, h.deps);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toContain('already open');
  });

  it('aborts (no GitHub side-effect) when the web app holds the lock (AC-7)', async () => {
    const artifact = makeArtifact({ proposals: [makeProposal({ id: 'prop:a', canonicalName: 'A' })] });
    const h = makeHarness({ artifact });
    // web app already holds the session
    const webHeld = acquireSurface(await h.ledger.read(SID), { surface: 'web' })!;
    h.ledger.seed(SID, webHeld);

    const res = await openSession(SID, h.deps);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('locked by the web app');
    // nothing was written or pushed
    expect(h.writer.calls.length).toBe(0);
    expect(h.jj.pushes.length).toBe(0);
  });

  it('aborts when the session was never ingested', async () => {
    const h = makeHarness(); // no artifact set
    const res = await openSession(SID, h.deps);
    expect(res.ok).toBe(false);
  });
});
