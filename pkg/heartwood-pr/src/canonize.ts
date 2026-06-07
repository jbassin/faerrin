// canonize (NLSpec 0002 §6.2 "bot: canonize"; AC-8/AC-21, D-11/D-15). THE LOCAL TRIGGER for a remote
// merge. A GitHub squash-merge is remote and sets nothing on the host (C10): the live wiki is already
// the merged tree, but `committedAt`, the lock release, and the build guard are LOCAL acts. This step
// detects the merge and performs them. Pure over its DI'd deps (fake-tested; the real build guard +
// jj run are the worldbuilder-gated boundary).
//
// Squash-merge reconciliation (D-15): jj git fetch imports the independent squash commit onto main →
// verify the tree → set committedAt / release lock → delete the local bookmark + abandon its now-
// redundant revisions. Verification FAILURE blocks canonization (committedAt stays unset, lock held)
// so a divergent merge is never silently blessed.

import {
  isMergeable,
  markProposalsCommitted,
  releaseSurface,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import type { BotDeps } from './deps';
import { proposalIsLive } from './redraft';

export interface CanonizeResult {
  ok: boolean;
  /** True iff the PR was merged AND canonization completed. */
  canonized: boolean;
  /** Why canonization did not happen (not merged yet) or failed (verification). */
  reason?: string;
  /** Set when a merge happened with a `/defer`red conflict still open — can't un-merge, so flag it
   *  (NLSpec 0002 open-decisions; the deferred conflict must be resolved in the workbench). */
  deferredAtMerge?: boolean;
}

export async function canonize(sid: SessionId, deps: BotDeps): Promise<CanonizeResult> {
  let state: ReviewState = await deps.ledger.read(sid);
  const link = state.reviewSurface;
  if (!link || link.surface !== 'pr' || link.prNumber === undefined) {
    return { ok: false, canonized: false, reason: `no open PR linkage for ${sid.arc}@${sid.date}` };
  }
  const branch = link.branch ?? deps.branchFor(sid);

  // Import any remote merge, then check PR state — the canonizer keys off MERGED state, not the merge
  // method, so a non-squash merge still reconciles (it just warns elsewhere).
  await deps.jj.gitFetch();
  const pr = await deps.gh.prView(link.prNumber);
  if (pr.state !== 'MERGED') {
    return { ok: true, canonized: false, reason: `PR #${link.prNumber} is ${pr.state}` };
  }

  // The 763-file build + diff guard (AC-21). FAILURE blocks canonization — never set committedAt,
  // never release the lock, so a divergent merge stays visible and recoverable.
  const verification = await deps.verifyBuild(sid);
  if (!verification.ok) {
    return { ok: false, canonized: false, reason: `merge verification failed: ${verification.reason ?? 'unknown'}` };
  }

  const artifact = await deps.artifacts.read(sid);
  if (!artifact) return { ok: false, canonized: false, reason: `session ${sid.arc}@${sid.date} not ingested` };

  const deferredAtMerge = !isMergeable(state); // merged despite a /defer (can't un-merge — flag it)

  // Local-only canonization acts (C10): stamp committedAt on exactly the pages that LANDED — the
  // same live set the branch carries (proposalIsLive), so the committedAt set and the merge tree
  // never diverge (AC-8).
  const landed = artifact.proposals.filter((p) => proposalIsLive(artifact, state, p)).map((p) => p.id);
  state = markProposalsCommitted(state, landed, deps.now());
  state = releaseSurface(state);
  await deps.ledger.write(sid, state);

  // jj cleanup (D-15): the squash commit is on main now; drop the redundant local branch and abandon
  // ALL of its own revisions (open draft + every redraft), not just the tip — revset `base..<tip>`.
  await deps.jj.bookmarkDelete(branch);
  if (link.lastBotBookmarkTarget) await deps.jj.abandon(`${deps.base}..${link.lastBotBookmarkTarget}`);

  return { ok: true, canonized: true, deferredAtMerge };
}
