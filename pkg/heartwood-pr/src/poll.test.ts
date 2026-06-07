import { beforeEach, describe, expect, it } from 'bun:test';
import {
  conflictNoteFor,
  conflictResolutionFor,
  decisionFor,
  isMergeable,
} from '@faerrin/heartwood/src/state/review';
import { conflictMarker } from './markers';
import { openSession } from './open-session';
import { pollOnce } from './poll';
import { type Harness, makeArtifact, makeConflict, makeHarness, makeProposal, SID } from './test-fixtures';

const CLAIM = 'prop:iom:c1';

function artifactWithConflict() {
  return makeArtifact({
    proposals: [
      makeProposal({ id: 'prop:clean', canonicalName: 'CleanPage' }),
      makeProposal({
        id: 'prop:iom',
        canonicalName: 'Iomenei',
        entityId: 'ent:iom',
        facts: [
          { claimId: 'prop:iom:c1', text: 'founded earlier', citations: [{ transcript: 't', start: 5, end: 5 }], modality: 'gm-stated' },
          { claimId: 'prop:iom:c2', text: 'a second fact', citations: [{ transcript: 't', start: 6, end: 6 }], modality: 'gm-stated' },
        ],
      }),
    ],
    conflicts: [makeConflict({ claimId: CLAIM, entityId: 'ent:iom' })],
  });
}

let h: Harness;
let prNumber: number;

beforeEach(async () => {
  h = makeHarness({ artifact: artifactWithConflict() });
  const res = await openSession(SID, h.deps);
  if (!res.ok) throw new Error('open failed');
  prNumber = res.prNumber;
});

/** A reviewer reply that quote-includes the conflict marker (GitHub "Quote reply" copies the marker). */
function reviewerReply(command: string, claimId = CLAIM): string {
  return `> existing canon…\n${conflictMarker(claimId)}\n${command}`;
}

describe('pollOnce — commands (AC-5/13/14/24)', () => {
  it('/keep rejects the claim, acks 👀→🚀, and is idempotent on re-poll', async () => {
    const id = h.gh.simulateComment(prNumber, 'josh', reviewerReply('/keep'));
    const r1 = await pollOnce(SID, h.deps);
    expect(r1.ok && r1.commandsApplied).toBe(1);
    expect(conflictResolutionFor(await h.ledger.read(SID), CLAIM)).toBe('rejected');
    expect(h.gh.reactionsOn(id).sort()).toEqual(['eyes', 'rocket']);

    const r2 = await pollOnce(SID, h.deps); // same comment, second tick
    expect(r2.ok && r2.commandsApplied).toBe(0); // not re-applied
  });

  it('/replace accepts + flags the page for redraft', async () => {
    h.gh.simulateComment(prNumber, 'josh', reviewerReply('/replace'));
    const r = await pollOnce(SID, h.deps);
    if (!r.ok) throw new Error('noop');
    expect(conflictResolutionFor(await h.ledger.read(SID), CLAIM)).toBe('accepted');
    expect(r.redraftPages).toContain('prop:iom');
  });

  it('/merge <note> accepts, persists the note, flags redraft', async () => {
    h.gh.simulateComment(prNumber, 'josh', reviewerReply('/merge lean on the older spelling'));
    const r = await pollOnce(SID, h.deps);
    if (!r.ok) throw new Error('noop');
    const state = await h.ledger.read(SID);
    expect(conflictResolutionFor(state, CLAIM)).toBe('accepted');
    expect(conflictNoteFor(state, CLAIM)).toBe('lean on the older spelling');
    expect(r.redraftPages).toContain('prop:iom');
  });

  it('/defer blocks merge and leaves the claim unresolved', async () => {
    h.gh.simulateComment(prNumber, 'josh', reviewerReply('/defer'));
    await pollOnce(SID, h.deps);
    const state = await h.ledger.read(SID);
    expect(isMergeable(state)).toBe(false);
    expect(conflictResolutionFor(state, CLAIM)).toBeUndefined();
  });

  it('ignores commands from a non-allowlisted author (AC-14)', async () => {
    h.gh.simulateComment(prNumber, 'a-stranger', reviewerReply('/replace'));
    const r = await pollOnce(SID, h.deps);
    expect(r.ok && r.commandsApplied).toBe(0);
    expect(conflictResolutionFor(await h.ledger.read(SID), CLAIM)).toBeUndefined();
  });

  it('ignores a non-command reviewer comment', async () => {
    h.gh.simulateComment(prNumber, 'josh', 'looks great, thanks!');
    const r = await pollOnce(SID, h.deps);
    expect(r.ok && r.commandsApplied).toBe(0);
  });

  it('flags an unbindable command with a confused reaction and does not reapply (AC-24)', async () => {
    const id = h.gh.simulateComment(prNumber, 'josh', '/replace'); // no marker
    const r = await pollOnce(SID, h.deps);
    expect(r.ok && r.ignored).toBe(1);
    expect(h.gh.reactionsOn(id)).toEqual(['confused']);
    const r2 = await pollOnce(SID, h.deps);
    expect(r2.ok && r2.ignored).toBe(0); // processed, not re-evaluated
  });

  it('last-write-wins: /replace then /keep ends rejected (AC-24)', async () => {
    h.gh.simulateComment(prNumber, 'josh', reviewerReply('/replace'));
    await pollOnce(SID, h.deps);
    h.gh.simulateComment(prNumber, 'josh', reviewerReply('/keep'));
    await pollOnce(SID, h.deps);
    expect(conflictResolutionFor(await h.ledger.read(SID), CLAIM)).toBe('rejected');
  });
});

describe('pollOnce — checkbox unchecks (AC-26)', () => {
  it('an uncheck records a per-proposal rejection (ledger authoritative)', async () => {
    const view = await h.gh.prView(prNumber);
    // reviewer unchecks the clean page
    h.gh.simulateBodyEdit(prNumber, view.body.replace('[x] **CleanPage**', '[ ] **CleanPage**'));
    const r = await pollOnce(SID, h.deps);
    expect(r.ok && r.unchecks).toBe(1);
    expect(decisionFor(await h.ledger.read(SID), 'prop:clean')).toBe('rejected');
  });

  it('does not re-detect the same uncheck on the next tick (baseline advances)', async () => {
    const view = await h.gh.prView(prNumber);
    h.gh.simulateBodyEdit(prNumber, view.body.replace('[x] **CleanPage**', '[ ] **CleanPage**'));
    await pollOnce(SID, h.deps);
    const r2 = await pollOnce(SID, h.deps);
    expect(r2.ok && r2.unchecks).toBe(0);
  });

  it('a re-check reverses the rejection back to approved', async () => {
    const view = await h.gh.prView(prNumber);
    h.gh.simulateBodyEdit(prNumber, view.body.replace('[x] **CleanPage**', '[ ] **CleanPage**'));
    await pollOnce(SID, h.deps);
    const unchecked = await h.gh.prView(prNumber);
    h.gh.simulateBodyEdit(prNumber, unchecked.body.replace('[ ] **CleanPage**', '[x] **CleanPage**'));
    const r = await pollOnce(SID, h.deps);
    expect(r.ok && r.rechecks).toBe(1);
    expect(decisionFor(await h.ledger.read(SID), 'prop:clean')).toBe('approved');
  });
});

describe('pollOnce — no-ops', () => {
  it('returns a noop when there is no open PR linkage', async () => {
    const fresh = makeHarness({ artifact: artifactWithConflict() });
    const r = await pollOnce(SID, fresh.deps);
    expect(r.ok).toBe(false);
  });
});
