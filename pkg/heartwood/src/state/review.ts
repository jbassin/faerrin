// Resumable review state (spec §7 "Review session state"; AC-6, AC-8). The review
// app persists the worldbuilder's per-proposal decisions here so NOTHING is written
// to the wiki until an explicit commit (AC-6), and reopening a half-reviewed session
// restores exactly where he stopped (AC-8). Kept separate from the SessionArtifact so
// re-ingesting a transcript (idempotent re-run) never clobbers decisions. node:fs.

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { writeFileAtomic } from './atomic';
import { sessionKey, type SessionId } from './identity';

export const DECISIONS = ['pending', 'approved', 'rejected', 'deferred'] as const;
export type Decision = (typeof DECISIONS)[number];

const SessionIdSchema = z.object({ arc: z.string(), date: z.string() });

export const ProposalDecisionSchema = z.object({
  proposalId: z.string(),
  decision: z.enum(DECISIONS),
  /**
   * The human-authored prose to commit for an approved amend/create (D-5: the tool
   * structures + cites, the human writes the sentence). "Edit" in the UI is just how
   * this text is produced before approval.
   */
  authoredText: z.string().optional(),
  /** Optional tagged reason for a rejection (feeds the Phase-4 quality log, AC-16). */
  rejectionReason: z.string().optional(),
  /** Content-relative path for an approved `create` proposal (chosen by the reviewer, AC-10). */
  targetPath: z.string().optional(),
  /** Set once the proposal's prose has been committed to the wiki — guards against re-committing. */
  committedAt: z.string().optional(),
  decidedAt: z.string(), // ISO
});
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>;

/** How the reviewer resolves a cross-arc canon conflict (AC-11). Never auto-resolved. */
export const CONFLICT_RESOLUTIONS = ['supersede', 'coexist', 'reject'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

export const ReviewStateSchema = z.object({
  sessionId: SessionIdSchema,
  /** Keyed by proposalId. Absent ⇒ pending. */
  decisions: z.record(z.string(), ProposalDecisionSchema),
  /** Conflict resolutions keyed by the conflicting claimId (AC-11). Defaulted for old files. */
  conflictResolutions: z.record(z.string(), z.enum(CONFLICT_RESOLUTIONS)).default({}),
  updatedAt: z.string(),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export function reviewStatePath(dir: string, id: SessionId): string {
  return join(dir, `${sessionKey(id)}.review.json`);
}

export function emptyReviewState(id: SessionId): ReviewState {
  return { sessionId: id, decisions: {}, conflictResolutions: {}, updatedAt: new Date().toISOString() };
}

/** Read review state, or a fresh empty one if the session was never opened. */
export async function readReviewState(dir: string, id: SessionId): Promise<ReviewState> {
  let text: string;
  try {
    text = await readFile(reviewStatePath(dir, id), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyReviewState(id);
    throw err;
  }
  return ReviewStateSchema.parse(JSON.parse(text));
}

export async function writeReviewState(dir: string, state: ReviewState): Promise<void> {
  const validated = ReviewStateSchema.parse(state);
  await writeFileAtomic(reviewStatePath(dir, validated.sessionId), JSON.stringify(validated, null, 2));
}

/** Pure: apply one decision, returning a new state (does not write). */
export function applyDecision(
  state: ReviewState,
  decision: Omit<ProposalDecision, 'decidedAt'> & { decidedAt?: string },
): ReviewState {
  const full: ProposalDecision = { ...decision, decidedAt: decision.decidedAt ?? new Date().toISOString() };
  return {
    ...state,
    decisions: { ...state.decisions, [full.proposalId]: full },
    updatedAt: new Date().toISOString(),
  };
}

export function decisionFor(state: ReviewState, proposalId: string): Decision {
  return state.decisions[proposalId]?.decision ?? 'pending';
}

/** Pure: record a conflict resolution by claimId (AC-11), returning a new state. */
export function applyConflictResolution(
  state: ReviewState,
  claimId: string,
  resolution: ConflictResolution,
): ReviewState {
  return {
    ...state,
    conflictResolutions: { ...state.conflictResolutions, [claimId]: resolution },
    updatedAt: new Date().toISOString(),
  };
}

export function conflictResolutionFor(state: ReviewState, claimId: string): ConflictResolution | undefined {
  return state.conflictResolutions[claimId];
}

export type ReviewStatus = 'unreviewed' | 'partial' | 'reviewed';

/**
 * Session-level status from decisions vs the proposal set. Reviewed ⇒ every proposal
 * reached a terminal decision (approved/rejected); a deferred or pending proposal keeps
 * it partial (AC-8).
 */
export function reviewStatus(state: ReviewState, proposalIds: string[]): ReviewStatus {
  if (proposalIds.length === 0) return 'reviewed';
  let decided = 0;
  let terminal = 0;
  for (const id of proposalIds) {
    const d = decisionFor(state, id);
    if (d !== 'pending') decided++;
    if (d === 'approved' || d === 'rejected') terminal++;
  }
  if (decided === 0) return 'unreviewed';
  return terminal === proposalIds.length ? 'reviewed' : 'partial';
}
