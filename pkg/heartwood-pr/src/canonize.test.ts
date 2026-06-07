import { describe, expect, it } from 'bun:test';
import { isSurfaceHeld } from '@faerrin/heartwood/src/state/review';
import { conflictMarker } from './markers';
import { canonize } from './canonize';
import { openSession } from './open-session';
import { pollOnce } from './poll';
import { type Harness, makeArtifact, makeConflict, makeHarness, makeProposal, SID } from './test-fixtures';

function artifact() {
  return makeArtifact({
    proposals: [
      makeProposal({ id: 'prop:a', canonicalName: 'A' }),
      makeProposal({ id: 'prop:b', canonicalName: 'B' }),
    ],
  });
}

async function opened(verify?: Harness['deps']['verifyBuild']): Promise<{ h: Harness; prNumber: number }> {
  const h = makeHarness({ artifact: artifact(), verify });
  const res = await openSession(SID, h.deps);
  if (!res.ok) throw new Error('open failed');
  return { h, prNumber: res.prNumber };
}

describe('canonize — the local trigger for a remote merge (AC-21, D-11/D-15)', () => {
  it('does nothing while the PR is still open', async () => {
    const { h } = await opened();
    const r = await canonize(SID, h.deps);
    expect(r.canonized).toBe(false);
    expect(isSurfaceHeld(await h.ledger.read(SID))).toBe(true); // lock still held
  });

  it('on merge: fetches, sets committedAt on landed pages, releases the lock, cleans the branch', async () => {
    const { h, prNumber } = await opened();
    h.gh.simulateMerge(prNumber);

    const r = await canonize(SID, h.deps);
    expect(r.ok).toBe(true);
    expect(r.canonized).toBe(true);

    const state = await h.ledger.read(SID);
    expect(isSurfaceHeld(state)).toBe(false); // lock released (AC-21)
    expect(state.decisions['prop:a']?.committedAt).toBeTruthy(); // landed (C10 local act)
    expect(state.decisions['prop:b']?.committedAt).toBeTruthy();
    expect(h.jj.fetches.length).toBe(1); // jj git fetch imported the squash (D-15)
    expect(h.jj.deleted).toContain('hw/through-a-song-darkly-2025-08-28'); // bookmark cleaned
    expect(h.jj.abandoned.length).toBe(1); // merged local revs abandoned
  });

  it('a rejected page is NOT marked committed (it never landed)', async () => {
    const { h, prNumber } = await opened();
    // reviewer unchecks prop:b before merging
    const view = await h.gh.prView(prNumber);
    h.gh.simulateBodyEdit(prNumber, view.body.replace('[x] **B**', '[ ] **B**'));
    await pollOnce(SID, h.deps);
    h.gh.simulateMerge(prNumber);

    await canonize(SID, h.deps);
    const state = await h.ledger.read(SID);
    expect(state.decisions['prop:a']?.committedAt).toBeTruthy();
    expect(state.decisions['prop:b']?.committedAt).toBeFalsy(); // rejected → never landed
  });

  it('verification FAILURE blocks canonization (committedAt unset, lock held)', async () => {
    const { h, prNumber } = await opened(async () => ({ ok: false, reason: 'unexpected 5 files changed' }));
    h.gh.simulateMerge(prNumber);

    const r = await canonize(SID, h.deps);
    expect(r.ok).toBe(false);
    expect(r.canonized).toBe(false);
    expect(r.reason).toContain('verification failed');
    const state = await h.ledger.read(SID);
    expect(isSurfaceHeld(state)).toBe(true); // lock STILL held — recoverable
    expect(state.decisions['prop:a']?.committedAt).toBeFalsy();
    expect(h.jj.deleted).toEqual([]); // no cleanup on a blocked merge
  });

  it('flags a merge that happened with a /defer still open (can\'t un-merge)', async () => {
    const conflicted = makeArtifact({
      proposals: [makeProposal({ id: 'prop:i', canonicalName: 'Iomenei', entityId: 'ent:iom', facts: [
        { claimId: 'prop:i:c1', text: 'x', citations: [{ transcript: 't', start: 1, end: 1 }], modality: 'gm-stated' },
      ] })],
      conflicts: [makeConflict({ claimId: 'prop:i:c1', entityId: 'ent:iom' })],
    });
    const h = makeHarness({ artifact: conflicted });
    const open = await openSession(SID, h.deps);
    if (!open.ok) throw new Error('open failed');
    h.gh.simulateComment(open.prNumber, 'josh', `${conflictMarker('prop:i:c1')}\n/defer`);
    await pollOnce(SID, h.deps);
    h.gh.simulateMerge(open.prNumber);

    const r = await canonize(SID, h.deps);
    expect(r.canonized).toBe(true);
    expect(r.deferredAtMerge).toBe(true); // flagged for workbench follow-up
  });

  it('noop when there is no PR linkage', async () => {
    const h = makeHarness({ artifact: artifact() });
    const r = await canonize(SID, h.deps);
    expect(r.ok).toBe(false);
  });
});
