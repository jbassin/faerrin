// redraftBatch (NLSpec 0002 §6.2 "bot: redraft"; AC-6/AC-10/AC-11/AC-12). After conflict
// resolutions, re-draft the affected pages' prose IN VOICE and push them additively to the branch —
// ONE pass per page (AC-12, bounded churn). Pure over its DI'd deps (fake-tested).
//
// Three guards:
//  - AC-6: the re-draft is conditioned on the persisted `/merge` note and excludes rejected facts.
//  - AC-10: a page the human hand-edited on the branch is SKIPPED (detected by jj `changedPaths`
//    between the bot's last pushed target and the live bookmark target — never a git SHA).
//  - AC-11: a redrafted page that was already approved is auto-unchecked + flagged in the body, so
//    nothing approved silently mutates.

import {
  acquireSurface,
  conflictNoteFor,
  conflictResolutionFor,
  decisionFor,
  isStaleApproval,
  markStaleApproval,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import type { SessionArtifact } from '@faerrin/heartwood/src/state/store';
import type { DraftInput } from '@faerrin/heartwood/src/pipeline/draft';
import { setCheckboxInBody } from './markers';
import type { BotDeps } from './deps';

type Proposal = SessionArtifact['proposals'][number];

const STALE_NOTE = '🔄 re-read — this changed since you approved it';

/** claimIds whose conflict the reviewer rejected (their fact is dropped from the page). */
function rejectedClaims(artifact: SessionArtifact, state: ReviewState): Set<string> {
  return new Set(
    artifact.conflicts.filter((c) => conflictResolutionFor(state, c.claimId) === 'rejected').map((c) => c.claimId),
  );
}

/**
 * Does this proposal still belong on the branch / merge tree? No, if the reviewer rejected the page
 * (unchecked it) OR every backing fact was rejected as a conflict (the page has nothing left to say).
 * Shared by redraftBatch (write vs remove) and canonize (which pages "landed") so the branch tree and
 * the committedAt set never diverge (AC-26/AC-8).
 */
export function proposalIsLive(artifact: SessionArtifact, state: ReviewState, p: Proposal): boolean {
  if (decisionFor(state, p.id) === 'rejected') return false;
  const rejected = rejectedClaims(artifact, state);
  return p.facts.some((f) => !rejected.has(f.claimId));
}

/** Build the re-draft input for a page: its non-rejected facts + the `/merge` note conditioning it. */
function redraftInputFor(artifact: SessionArtifact, state: ReviewState, p: Proposal): DraftInput {
  const rejected = rejectedClaims(artifact, state);
  const facts = p.facts.filter((f) => !rejected.has(f.claimId)).map((f) => ({ text: f.text }));
  // The note (if any) from this page's conflicting claims conditions the re-draft (AC-6).
  const note = artifact.conflicts
    .filter((c) => c.entityId === p.entityId)
    .map((c) => conflictNoteFor(state, c.claimId))
    .find((n): n is string => Boolean(n));
  return { canonicalName: p.canonicalName, kind: p.kind, facts, instructions: note };
}

export interface RedraftOk {
  ok: true;
  redrafted: string[];
  /** Pages reverted/deleted off the branch because they were rejected/emptied (AC-26/AC-8). */
  removed: string[];
  skippedHumanEdited: string[];
  pushed: boolean;
}
export interface RedraftNoop {
  ok: false;
  reason: string;
}
export type RedraftResult = RedraftOk | RedraftNoop;

export async function redraftBatch(
  sid: SessionId,
  deps: BotDeps,
  proposalIds: string[],
): Promise<RedraftResult> {
  let state: ReviewState = await deps.ledger.read(sid);
  const link = state.reviewSurface;
  if (!link || link.surface !== 'pr' || link.prNumber === undefined) {
    return { ok: false, reason: `no open PR linkage for ${sid.arc}@${sid.date}` };
  }
  const artifact = await deps.artifacts.read(sid);
  if (!artifact) return { ok: false, reason: `session ${sid.arc}@${sid.date} not ingested` };

  const branch = link.branch ?? deps.branchFor(sid);
  const byId = new Map(artifact.proposals.map((p) => [p.id, p]));
  const targets = [...new Set(proposalIds)].map((id) => byId.get(id)).filter((p): p is Proposal => !!p);
  if (targets.length === 0) {
    return { ok: true, redrafted: [], removed: [], skippedHumanEdited: [], pushed: false };
  }

  // AC-10: which pages did the human hand-edit on the branch since the bot's last push?
  let humanPaths: string[] = [];
  const liveTarget = await deps.jj.bookmarkTarget(branch);
  if (liveTarget && link.lastBotBookmarkTarget && liveTarget !== link.lastBotBookmarkTarget) {
    humanPaths = await deps.jj.changedPaths(link.lastBotBookmarkTarget, liveTarget);
  }

  const pages: { proposalId: string; prose: string; action?: 'write' | 'remove' }[] = [];
  const redrafted: string[] = [];
  const removed: string[] = [];
  const skippedHumanEdited: string[] = [];

  for (const p of targets) {
    if (p.targetPath && humanPaths.includes(p.targetPath)) {
      await deps.gh.postComment(
        link.prNumber,
        `Left your hand-edit on **${p.canonicalName}** alone — skipping the re-draft.`,
      );
      skippedHumanEdited.push(p.id);
      continue;
    }
    if (!proposalIsLive(artifact, state, p)) {
      // Rejected or emptied → revert/delete it off the branch so it never reaches the merge tree.
      pages.push({ proposalId: p.id, prose: '', action: 'remove' });
      removed.push(p.id);
      continue;
    }
    const { draft } = await deps.draft(redraftInputFor(artifact, state, p));
    pages.push({ proposalId: p.id, prose: draft });
    redrafted.push(p.id);
    // AC-11: an approved page whose prose just changed must be re-read → auto-uncheck + flag.
    state = markStaleApproval(state, p.id);
  }

  let pushed = false;
  if (pages.length > 0) {
    const { revision } = await deps.writeBranch(sid, pages);
    await deps.jj.bookmarkSet(branch, revision);
    await deps.jj.gitPush(branch); // additive (AC-9)
    pushed = true;

    // Patch the body: uncheck + flag the now-stale pages, then advance the linkage (new bot target +
    // the body baseline so the bot's own edit isn't re-read as a reviewer uncheck on the next poll).
    let body = link.lastSeenPrBody ?? (await deps.gh.prView(link.prNumber)).body;
    for (const id of redrafted) {
      if (isStaleApproval(state, id)) body = setCheckboxInBody(body, id, false, STALE_NOTE);
    }
    await deps.gh.updateBody(link.prNumber, body);
    const relinked = acquireSurface(state, { ...link, lastBotBookmarkTarget: revision, lastSeenPrBody: body });
    if (relinked) state = relinked;
  }

  await deps.ledger.write(sid, state);
  return { ok: true, redrafted, removed, skippedHumanEdited, pushed };
}
