import { describe, expect, it } from 'bun:test';
import { decisionFor, isStaleApproval } from '@faerrin/heartwood/src/state/review';
import type { DraftInput } from '@faerrin/heartwood/src/pipeline/draft';
import { parseCheckboxStates } from './markers';
import { openSession } from './open-session';
import { pollOnce } from './poll';
import { redraftBatch } from './redraft';
import { conflictMarker } from './markers';
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
        ],
      }),
    ],
    conflicts: [makeConflict({ claimId: CLAIM, entityId: 'ent:iom' })],
  });
}

function reply(command: string): string {
  return `> ctx\n${conflictMarker(CLAIM)}\n${command}`;
}

/** Open a session, run a command, and return the harness + PR number + recorded draft inputs. */
async function setup(command: string, draftInputs: DraftInput[]): Promise<{ h: Harness; prNumber: number }> {
  const h = makeHarness({
    artifact: artifactWithConflict(),
    draftFn: async (input) => {
      draftInputs.push(input);
      return { draft: `Draft(${input.canonicalName}${input.instructions ? `|${input.instructions}` : ''})` };
    },
  });
  const open = await openSession(SID, h.deps);
  if (!open.ok) throw new Error('open failed');
  h.gh.simulateComment(open.prNumber, 'josh', reply(command));
  await pollOnce(SID, h.deps);
  return { h, prNumber: open.prNumber };
}

describe('redraftBatch (NLSpec 0002 AC-6/12)', () => {
  it('re-drafts the resolved page, writes it to the branch, and pushes additively', async () => {
    const inputs: DraftInput[] = [];
    const { h } = await setup('/replace', inputs);
    const before = h.writer.calls.length;

    const r = await redraftBatch(SID, h.deps, ['prop:iom']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.redrafted).toEqual(['prop:iom']);
    expect(r.pushed).toBe(true);
    // exactly one more branch write (one pass for the one page, AC-12)
    expect(h.writer.calls.length).toBe(before + 1);
    expect(h.writer.calls.at(-1)!.pages.map((p) => p.proposalId)).toEqual(['prop:iom']);
    // pushed at the new revision
    expect(h.jj.pushes.at(-1)!.target).toBe(h.writer.lastRevision);
  });

  it('conditions the re-draft on a /merge note (AC-6)', async () => {
    const inputs: DraftInput[] = [];
    const { h } = await setup('/merge use the elegiac older spelling', inputs);
    inputs.length = 0; // ignore the open-time drafts

    await redraftBatch(SID, h.deps, ['prop:iom']);
    const iomInput = inputs.find((i) => i.canonicalName === 'Iomenei');
    expect(iomInput?.instructions).toBe('use the elegiac older spelling');
  });

  it('drops a rejected fact from the re-draft input', async () => {
    const inputs: DraftInput[] = [];
    const { h } = await setup('/keep', inputs); // /keep rejects the claim
    inputs.length = 0;
    await redraftBatch(SID, h.deps, ['prop:iom']);
    const iomInput = inputs.find((i) => i.canonicalName === 'Iomenei');
    // prop:iom's only fact was the rejected conflict claim → no facts remain
    expect(iomInput?.facts).toEqual([]);
  });
});

describe('redraftBatch — don\'t clobber human edits (AC-10)', () => {
  it('skips a page the human hand-edited on the branch and comments', async () => {
    const inputs: DraftInput[] = [];
    const { h, prNumber } = await setup('/replace', inputs);
    const botTarget = h.writer.lastRevision;
    // reviewer pushes a hand-edit to Iomenei.md
    h.jj.simulateHumanEdit('hw/through-a-song-darkly-2025-08-28', botTarget, 'human-rev', ['wiki/Iomenei.md']);

    const before = h.writer.calls.length;
    const r = await redraftBatch(SID, h.deps, ['prop:iom']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skippedHumanEdited).toEqual(['prop:iom']);
    expect(r.redrafted).toEqual([]);
    expect(h.writer.calls.length).toBe(before); // nothing written
    const comments = await h.gh.listComments(prNumber);
    expect(comments.some((c) => c.body.includes('Left your hand-edit on **Iomenei**'))).toBe(true);
  });
});

describe('redraftBatch — auto-uncheck invalidated approvals (AC-11)', () => {
  it('unchecks + flags a redrafted page in the body and marks it stale', async () => {
    const inputs: DraftInput[] = [];
    const { h, prNumber } = await setup('/replace', inputs);

    await redraftBatch(SID, h.deps, ['prop:iom']);
    const state = await h.ledger.read(SID);
    expect(isStaleApproval(state, 'prop:iom')).toBe(true);

    const body = (await h.gh.prView(prNumber)).body;
    expect(parseCheckboxStates(body).get('prop:iom')).toBe(false); // auto-unchecked
    expect(body).toContain('re-read — this changed');
  });

  it('a reviewer re-check clears the stale flag and re-approves (AC-11)', async () => {
    const inputs: DraftInput[] = [];
    const { h, prNumber } = await setup('/replace', inputs);
    await redraftBatch(SID, h.deps, ['prop:iom']);

    // reviewer re-checks the page in the body
    const unchecked = (await h.gh.prView(prNumber)).body;
    h.gh.simulateBodyEdit(prNumber, unchecked.replace('[ ] **Iomenei**', '[x] **Iomenei**'));
    await pollOnce(SID, h.deps);

    const state = await h.ledger.read(SID);
    expect(isStaleApproval(state, 'prop:iom')).toBe(false);
    expect(decisionFor(state, 'prop:iom')).toBe('approved');
  });
});
