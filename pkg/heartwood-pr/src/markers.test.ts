import { describe, expect, it } from 'bun:test';
import {
  conflictMarker,
  diffCheckboxState,
  parseCheckboxStates,
  parseConflictMarker,
  parseProposalMarker,
  proposalMarker,
} from './markers';

describe('binding markers (NLSpec 0002 AC-13/AC-26)', () => {
  it('round-trips a conflict marker', () => {
    const m = conflictMarker('claim:abc-1');
    expect(parseConflictMarker(`Some context\n${m}\nmore`)).toBe('claim:abc-1');
  });

  it('round-trips a proposal marker', () => {
    const m = proposalMarker('prop:e7');
    expect(parseProposalMarker(`- [x] **Sableclutch** ${m}`)).toBe('prop:e7');
  });

  it('returns null when no marker is present', () => {
    expect(parseConflictMarker('just a normal comment')).toBeNull();
    expect(parseProposalMarker('- [x] no marker here')).toBeNull();
  });

  it('markers are invisible HTML comments (no visible text leaks)', () => {
    expect(conflictMarker('c1')).toBe('<!-- hw:conflict c1 -->');
    expect(proposalMarker('p1')).toBe('<!-- hw:proposal p1 -->');
  });
});

describe('parseCheckboxStates', () => {
  const body = [
    '## Session edits',
    '',
    `- [x] **Sableclutch** — a dock fact ${proposalMarker('prop:1')}`,
    `- [ ] **Iomenei** — a corrected date ${proposalMarker('prop:2')}`,
    '- [x] a stray checkbox with no marker',
    'Some prose, not a checkbox.',
  ].join('\n');

  it('maps only marked checkboxes to their checked state', () => {
    const states = parseCheckboxStates(body);
    expect(states.get('prop:1')).toBe(true);
    expect(states.get('prop:2')).toBe(false);
    expect(states.size).toBe(2); // the stray checkbox (no marker) is ignored
  });

  it('accepts `- [X]` uppercase and `*` bullets', () => {
    const states = parseCheckboxStates(`* [X] thing ${proposalMarker('prop:9')}`);
    expect(states.get('prop:9')).toBe(true);
  });
});

describe('diffCheckboxState — uncheck detection (AC-26)', () => {
  const v1 = [
    `- [x] **A** ${proposalMarker('prop:1')}`,
    `- [x] **B** ${proposalMarker('prop:2')}`,
  ].join('\n');

  it('detects an uncheck as a rejection', () => {
    const v2 = [
      `- [ ] **A** ${proposalMarker('prop:1')}`,
      `- [x] **B** ${proposalMarker('prop:2')}`,
    ].join('\n');
    expect(diffCheckboxState(v1, v2)).toEqual([{ proposalId: 'prop:1', checked: false }]);
  });

  it('detects a re-check as a reversal', () => {
    const v2 = `- [ ] **A** ${proposalMarker('prop:1')}\n- [x] **B** ${proposalMarker('prop:2')}`;
    const v3 = `- [x] **A** ${proposalMarker('prop:1')}\n- [x] **B** ${proposalMarker('prop:2')}`;
    expect(diffCheckboxState(v2, v3)).toEqual([{ proposalId: 'prop:1', checked: true }]);
  });

  it('no changes when nothing flipped', () => {
    expect(diffCheckboxState(v1, v1)).toEqual([]);
  });

  it('ignores proposals that appear in only one revision (re-ingest, AC-20)', () => {
    const v2 = `- [ ] **A** ${proposalMarker('prop:1')}`; // prop:2 dropped
    expect(diffCheckboxState(v1, v2)).toEqual([{ proposalId: 'prop:1', checked: false }]);
  });
});
