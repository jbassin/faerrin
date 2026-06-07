import { describe, expect, it } from 'bun:test';
import {
  conflictResolutionFor,
  deferConflict,
  emptyReviewState,
  isMergeable,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';
import { applyCommand, parseCommand } from './command';

const SID = { arc: 'through-a-song-darkly', date: '2025-08-28' };
const fresh = (): ReviewState => emptyReviewState(SID);

describe('parseCommand (NLSpec 0002 D-7, AC-24)', () => {
  it('parses each command in the fixed vocabulary', () => {
    expect(parseCommand('/keep').command).toEqual({ kind: 'keep' });
    expect(parseCommand('/replace').command).toEqual({ kind: 'replace' });
    expect(parseCommand('/defer').command).toEqual({ kind: 'defer' });
    expect(parseCommand('/merge keep the older title').command).toEqual({
      kind: 'merge',
      note: 'keep the older title',
    });
  });

  it('returns null for a comment with no command (ignored upstream)', () => {
    expect(parseCommand('looks good to me, thanks!').command).toBeNull();
    expect(parseCommand('').command).toBeNull();
  });

  it('honors only the FIRST command and flags the rest (AC-24)', () => {
    const p = parseCommand('/keep\nactually /replace');
    expect(p.command).toEqual({ kind: 'keep' });
    expect(p.ignoredExtras).toBe(1);
  });

  it('degrades /merge with an empty note to /replace (AC-24)', () => {
    const p = parseCommand('/merge   ');
    expect(p.command).toEqual({ kind: 'replace' });
    expect(p.degradedEmptyMerge).toBe(true);
  });

  it('recognizes a command mid-line at a word boundary but not inside a URL', () => {
    expect(parseCommand('hmm /defer for now').command).toEqual({ kind: 'defer' });
    // a slash-path inside a URL is not a command
    expect(parseCommand('see https://example.com/keepsake').command).toBeNull();
  });

  it('does not match a longer word (/merged, /keeper)', () => {
    expect(parseCommand('we /merged this elsewhere').command).toBeNull();
    expect(parseCommand('the /keeper of secrets').command).toBeNull();
  });

  it('captures only the note on the merge line, not following lines', () => {
    const p = parseCommand('/merge use the dock spelling\nextra context below');
    expect(p.command).toEqual({ kind: 'merge', note: 'use the dock spelling' });
  });
});

describe('applyCommand → shared ledger (NLSpec 0002 §6.4, AC-5/AC-6)', () => {
  it('/keep rejects the claim, no re-draft when it was never accepted', () => {
    const r = applyCommand(fresh(), 'c1', { kind: 'keep' });
    expect(conflictResolutionFor(r.state, 'c1')).toBe('rejected');
    expect(r.resolution).toBe('rejected');
    expect(r.redraft).toBe(false);
  });

  it('/replace accepts the claim and triggers a re-draft', () => {
    const r = applyCommand(fresh(), 'c1', { kind: 'replace' });
    expect(conflictResolutionFor(r.state, 'c1')).toBe('accepted');
    expect(r.redraft).toBe(true);
  });

  it('/merge accepts + carries note as draft instructions, always re-drafts', () => {
    const r = applyCommand(fresh(), 'c1', { kind: 'merge', note: 'lean on the river imagery' });
    expect(conflictResolutionFor(r.state, 'c1')).toBe('accepted');
    expect(r.redraft).toBe(true);
    expect(r.instructions).toBe('lean on the river imagery');
  });

  it('/defer blocks merge and leaves the claim unresolved', () => {
    const r = applyCommand(fresh(), 'c1', { kind: 'defer' });
    expect(r.resolution).toBe('deferred');
    expect(conflictResolutionFor(r.state, 'c1')).toBeUndefined();
    expect(isMergeable(r.state)).toBe(false);
  });

  it('a duplicate /replace on an already-accepted claim is idempotent (no re-draft)', () => {
    const first = applyCommand(fresh(), 'c1', { kind: 'replace' });
    const second = applyCommand(first.state, 'c1', { kind: 'replace' });
    expect(second.redraft).toBe(false);
  });

  it('reversing /replace with /keep re-drafts to remove the now-dropped fact (last-write-wins, AC-24)', () => {
    const accepted = applyCommand(fresh(), 'c1', { kind: 'replace' });
    const reversed = applyCommand(accepted.state, 'c1', { kind: 'keep' });
    expect(conflictResolutionFor(reversed.state, 'c1')).toBe('rejected');
    expect(reversed.redraft).toBe(true);
  });

  it('/defer after an accept re-drafts to remove the fact and blocks merge', () => {
    const accepted = applyCommand(fresh(), 'c1', { kind: 'replace' });
    const deferred = applyCommand(accepted.state, 'c1', { kind: 'defer' });
    expect(deferred.redraft).toBe(true);
    expect(isMergeable(deferred.state)).toBe(false);
  });

  it('re-resolving a deferred conflict with /replace clears the defer (mergeable again)', () => {
    const deferredState = deferConflict(fresh(), 'c1');
    expect(isMergeable(deferredState)).toBe(false);
    const r = applyCommand(deferredState, 'c1', { kind: 'replace' });
    expect(isMergeable(r.state)).toBe(true);
    expect(conflictResolutionFor(r.state, 'c1')).toBe('accepted');
  });
});
