import { describe, expect, it } from 'bun:test';
import {
  applyDecision,
  emptyReviewState,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';
import type { SessionArtifact } from '@faerrin/heartwood/src/state/store';
import { hasStrippedConstructs } from './render-safe';
import { parseCheckboxStates } from './markers';
import { buildPrBody, isTrivial } from './pr-body';

const SID = { arc: 'through-a-song-darkly', date: '2025-08-28' };

function cite(transcript: string, start: number, end = start) {
  return { transcript, start, end };
}

type Proposal = SessionArtifact['proposals'][number];

function proposal(over: Partial<Proposal> & { id: string; canonicalName: string }): Proposal {
  return {
    kind: 'amend',
    status: 'existing',
    entityId: over.entityId ?? `ent:${over.id}`,
    targetPath: `wiki/${over.canonicalName}.md`,
    facts: [],
    ...over,
  } as Proposal;
}

function artifact(over: Partial<SessionArtifact> = {}): SessionArtifact {
  return {
    sessionId: SID,
    transcript: 'through-a-song-darkly@2025-08-28.md',
    contentHash: 'deadbeef',
    generatedAt: '2026-06-06T00:00:00.000Z',
    narrative: 'The docks shifted hands by morning, and the [[Drowned Court]] said nothing.',
    triage: { canon: [], uncertain: [], noise: [] },
    proposals: [],
    entities: [],
    needsConfirmation: [],
    conflicts: [],
    ...over,
  };
}

describe('buildPrBody — narrative-led structure (AC-1)', () => {
  const art = artifact({
    proposals: [
      proposal({
        id: 'prop:sable',
        canonicalName: 'Sableclutch',
        facts: [
          { claimId: 'c1', text: 'The river guild now controls the warehouses.', citations: [cite('t', 10, 12)], modality: 'gm-stated' },
          { claimId: 'c2', text: 'Tolls were raised at the locks.', citations: [cite('t', 13, 14)], modality: 'gm-stated' },
        ],
      }),
    ],
  });
  const body = buildPrBody({ artifact: art, state: emptyReviewState(SID) });

  it('leads with a counts header and the recap, then events', () => {
    const headerIdx = body.indexOf('**Session');
    const recapIdx = body.indexOf('Drowned Court');
    const eventIdx = body.indexOf('### Event 1');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(recapIdx).toBeGreaterThan(headerIdx);
    expect(eventIdx).toBeGreaterThan(recapIdx);
    expect(body).toContain('1 page · 1 event · 0 conflicts');
  });

  it('renders the recap sanitizer-safe (wikilink → display text, no [[ ]])', () => {
    expect(body).toContain('> The docks shifted hands');
    expect(body).toContain('Drowned Court');
    expect(body).not.toContain('[[');
  });

  it('the whole body is sanitizer-safe (AC-23)', () => {
    expect(hasStrippedConstructs(body)).toBe(false);
  });
});

describe('buildPrBody — subtractive checkboxes (AC-3/AC-26)', () => {
  const art = artifact({
    proposals: [
      proposal({ id: 'prop:a', canonicalName: 'PageA', facts: [
        { claimId: 'c1', text: 'fact one', citations: [cite('t', 1)], modality: 'gm-stated' },
        { claimId: 'c2', text: 'fact two', citations: [cite('t', 2)], modality: 'gm-stated' },
      ] }),
      proposal({ id: 'prop:b', canonicalName: 'PageB', facts: [
        { claimId: 'c3', text: 'fact three', citations: [cite('t', 3)], modality: 'gm-stated' },
        { claimId: 'c4', text: 'fact four', citations: [cite('t', 4)], modality: 'gm-stated' },
      ] }),
    ],
  });

  it('clean proposals are PRE-CHECKED and bound to their proposal by a marker', () => {
    const states = parseCheckboxStates(buildPrBody({ artifact: art, state: emptyReviewState(SID) }));
    expect(states.get('prop:a')).toBe(true);
    expect(states.get('prop:b')).toBe(true);
  });

  it('the ledger is authoritative: a rejected proposal renders UNCHECKED', () => {
    let state: ReviewState = emptyReviewState(SID);
    state = applyDecision(state, { proposalId: 'prop:a', decision: 'rejected' });
    const states = parseCheckboxStates(buildPrBody({ artifact: art, state }));
    expect(states.get('prop:a')).toBe(false);
    expect(states.get('prop:b')).toBe(true);
  });
});

describe('buildPrBody — rendered prose + preview link (AC-2)', () => {
  const art = artifact({
    proposals: [proposal({ id: 'prop:a', canonicalName: 'PageA', facts: [
      { claimId: 'c1', text: 'one', citations: [cite('t', 1)], modality: 'gm-stated' },
      { claimId: 'c2', text: 'two', citations: [cite('t', 2)], modality: 'gm-stated' },
    ] })],
  });

  it('shows the in-voice draft as a blockquote, not a +/- diff', () => {
    const body = buildPrBody({
      artifact: art,
      state: emptyReviewState(SID),
      drafts: { 'prop:a': 'The warehouses answer to the river guild now.' },
    });
    expect(body).toContain('> The warehouses answer to the river guild now.');
    expect(body).not.toContain('@@'); // no diff hunk markers
  });

  it('includes a per-page deploy-preview link when provided', () => {
    const body = buildPrBody({
      artifact: art,
      state: emptyReviewState(SID),
      previewUrls: { 'prop:a': 'https://preview.example/PageA' },
    });
    expect(body).toContain('[preview ↗](https://preview.example/PageA)');
  });
});

describe('buildPrBody — trivial collapse + conflict annotation (AC-16/AC-25)', () => {
  it('collapses trivial (single-fact amend) edits under a count', () => {
    const art = artifact({
      proposals: [
        proposal({ id: 'prop:big', canonicalName: 'BigPage', facts: [
          { claimId: 'c1', text: 'a', citations: [cite('t', 1)], modality: 'gm-stated' },
          { claimId: 'c2', text: 'b', citations: [cite('t', 1)], modality: 'gm-stated' },
        ] }),
        proposal({ id: 'prop:triv', canonicalName: 'TrivPage', facts: [
          { claimId: 'c3', text: 'a date', citations: [cite('t', 1)], modality: 'gm-stated' },
        ] }),
      ],
    });
    expect(isTrivial(art.proposals[1]!)).toBe(true);
    const body = buildPrBody({ artifact: art, state: emptyReviewState(SID) });
    expect(body).toContain('<details><summary>1 trivial edit</summary>');
    // both pages still carry a checkbox (the trivial one inside the <details>)
    const states = parseCheckboxStates(body);
    expect(states.get('prop:big')).toBe(true);
    expect(states.get('prop:triv')).toBe(true);
  });

  it('annotates a conflicted page and keeps the body sanitizer-safe', () => {
    const art = artifact({
      proposals: [proposal({ id: 'prop:x', canonicalName: 'Iomenei', entityId: 'ent:iom', facts: [
        { claimId: 'c1', text: 'founded earlier than recorded', citations: [cite('t', 5)], modality: 'gm-stated' },
        { claimId: 'c2', text: 'a second fact', citations: [cite('t', 6)], modality: 'gm-stated' },
      ] })],
      conflicts: [{
        claimId: 'c1', entityId: 'ent:iom', canonicalName: 'Iomenei',
        newStatement: 'founded earlier', existingStatement: 'founded in 1200',
        source: 'wiki', sourceRef: 'wiki/Iomenei.md', explanation: 'date mismatch',
      }],
    });
    const body = buildPrBody({ artifact: art, state: emptyReviewState(SID) });
    expect(body).toContain('⚠️ canon conflict');
    expect(body).toContain('1 conflict');
    expect(hasStrippedConstructs(body)).toBe(false);
  });
});
