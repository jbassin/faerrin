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

/** Where approved amend prose is woven into the page (AC-12). */
export const WEAVE_MODES = ['end', 'into', 'after'] as const;
export type WeaveMode = (typeof WEAVE_MODES)[number];
export const WeaveTargetSchema = z.object({
  mode: z.enum(WEAVE_MODES),
  /** The target paragraph's current text (located at commit) for 'into'/'after'. */
  anchorText: z.string().optional(),
});
export type WeaveTarget = z.infer<typeof WeaveTargetSchema>;

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
  /** Where to weave approved amend prose (AC-12); absent ⇒ append at end. */
  weave: WeaveTargetSchema.optional(),
  /** Set once the proposal's prose has been committed to the wiki — guards against re-committing. */
  committedAt: z.string().optional(),
  decidedAt: z.string(), // ISO
});
export type ProposalDecision = z.infer<typeof ProposalDecisionSchema>;

/**
 * How the reviewer resolves a flagged canon conflict (AC-11). Never auto-resolved.
 * - `accepted` — the contradicting new fact is a real change: keep it in its page's proposal
 *   (the page becomes a correction of existing canon).
 * - `rejected` — drop the contradicting fact from its proposal; the page keeps the old canon.
 */
export const CONFLICT_RESOLUTIONS = ['accepted', 'rejected'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

// Migrate legacy resolutions (the earlier supersede/coexist/reject model) from older local
// review files so a stale state file never fails to load: supersede/coexist → accepted (the
// new fact stood), reject → rejected (the new fact was dropped); anything else is discarded.
function migrateConflictResolutions(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, ConflictResolution> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === 'accepted' || val === 'supersede' || val === 'coexist') out[k] = 'accepted';
    else if (val === 'rejected' || val === 'reject') out[k] = 'rejected';
  }
  return out;
}

/**
 * Which surface is actively reviewing a session (NLSpec 0002 §7, D-4/D-13). One ledger, one
 * active surface: while a session's PR is open the web app is read-only for it, and vice-versa.
 * `null` ⇒ neither holds it. Validity is *derived from PR-open state* — see `isSurfaceHeld`/
 * the bot's crash-recovery reconciliation (AC-22): a dead bot can't wedge a session because the
 * marker is reconciled against actually-open PRs on start.
 */
export const REVIEW_SURFACES = ['web', 'pr'] as const;
export type ReviewSurface = (typeof REVIEW_SURFACES)[number];

/**
 * PR linkage for the session (NLSpec 0002 §7). The bot-vs-human commit discriminator is
 * **jj-aware**: `lastBotBookmarkTarget` is the bookmark target the bot last pushed, NOT a git SHA
 * (jj churns SHAs on every push), so a page the human hand-edited on the branch is detectable
 * (AC-10, D-14).
 */
export const PrLinkageSchema = z.object({
  surface: z.enum(REVIEW_SURFACES),
  prNumber: z.number().int().positive().optional(),
  branch: z.string().optional(),
  lastBotBookmarkTarget: z.string().optional(),
  acquiredAt: z.string(), // ISO
});
export type PrLinkage = z.infer<typeof PrLinkageSchema>;

export const ReviewStateSchema = z.object({
  sessionId: SessionIdSchema,
  /** Keyed by proposalId. Absent ⇒ pending. */
  decisions: z.record(z.string(), ProposalDecisionSchema),
  /** Conflict resolutions keyed by the conflicting claimId (AC-11). Defaulted for old files;
   *  legacy supersede/coexist/reject values are migrated on read. */
  conflictResolutions: z
    .preprocess(migrateConflictResolutions, z.record(z.string(), z.enum(CONFLICT_RESOLUTIONS)))
    .default({}),
  /** Claim ids the reviewer promoted from Uncertain/Noise back to Canon (AC-14). */
  promotedClaims: z.array(z.string()).default([]),
  /**
   * The single active review surface + its PR linkage (NLSpec 0002 D-4/D-13). Absent ⇒ unlocked.
   * Distinct from a proposal's `'deferred'` *decision*: this is session-level mutual exclusion.
   */
  reviewSurface: PrLinkageSchema.nullable().default(null),
  /**
   * Conflict claimIds the reviewer `/defer`red in the PR (NLSpec 0002 D-12). This is a
   * **conflict-level** defer, deliberately separate from the proposal-level `'deferred'` decision:
   * a `/defer`red conflict has *no* accept/reject resolution yet and **blocks merge** (AC-24); it
   * is resolved in the web app after the PR is closed. `isMergeable` reads this set.
   */
  deferredConflicts: z.array(z.string()).default([]),
  /**
   * Idempotency audit for PR-comment commands (NLSpec 0002 §7, AC-13): processed GitHub
   * `comment.id` → the resolution it produced. Durable independent of GitHub's thread state (a
   * force-push can mark threads "outdated"); lets the bot catch up on offline commands without
   * re-applying ones it already handled.
   */
  processedComments: z.record(z.string(), z.string()).default({}),
  updatedAt: z.string(),
});
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export function reviewStatePath(dir: string, id: SessionId): string {
  return join(dir, `${sessionKey(id)}.review.json`);
}

export function emptyReviewState(id: SessionId): ReviewState {
  return {
    sessionId: id,
    decisions: {},
    conflictResolutions: {},
    promotedClaims: [],
    reviewSurface: null,
    deferredConflicts: [],
    processedComments: {},
    updatedAt: new Date().toISOString(),
  };
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

/** Pure: record a conflict resolution by claimId (AC-11), returning a new state. Resolving a
 *  claim also clears any prior `/defer` on it (last-write-wins re-resolution — AC-24). */
export function applyConflictResolution(
  state: ReviewState,
  claimId: string,
  resolution: ConflictResolution,
): ReviewState {
  return {
    ...state,
    conflictResolutions: { ...state.conflictResolutions, [claimId]: resolution },
    deferredConflicts: state.deferredConflicts.includes(claimId)
      ? state.deferredConflicts.filter((c) => c !== claimId)
      : state.deferredConflicts,
    updatedAt: new Date().toISOString(),
  };
}

export function conflictResolutionFor(state: ReviewState, claimId: string): ConflictResolution | undefined {
  return state.conflictResolutions[claimId];
}

/** Pure: toggle a claim's promotion to canon (AC-14), returning a new state. */
export function togglePromotion(state: ReviewState, claimId: string): ReviewState {
  const has = state.promotedClaims.includes(claimId);
  return {
    ...state,
    promotedClaims: has
      ? state.promotedClaims.filter((c) => c !== claimId)
      : [...state.promotedClaims, claimId],
    updatedAt: new Date().toISOString(),
  };
}

// ── Session lock (NLSpec 0002 D-4/D-13): one ledger, one active surface ──────────────────────

/** Is a surface currently holding this session? (Marker only — callers reconcile against
 *  actually-open PRs for crash recovery, AC-22.) */
export function isSurfaceHeld(state: ReviewState): boolean {
  return state.reviewSurface !== null;
}

/**
 * Pure compare-and-swap acquire (AC-7): a surface may take the lock iff it is free, or it already
 * holds it (idempotent re-acquire that refreshes linkage). Returns the new state on success, or
 * `null` if the *other* surface holds it — the caller treats `null` as "lost the race / locked
 * elsewhere". Two near-simultaneous opens therefore settle to one winner (the second sees the
 * first's marker and gets `null`).
 */
export function acquireSurface(
  state: ReviewState,
  link: Omit<PrLinkage, 'acquiredAt'> & { acquiredAt?: string },
): ReviewState | null {
  const held = state.reviewSurface;
  if (held && held.surface !== link.surface) return null;
  const full: PrLinkage = {
    ...link,
    acquiredAt: link.acquiredAt ?? held?.acquiredAt ?? new Date().toISOString(),
  };
  return { ...state, reviewSurface: full, updatedAt: new Date().toISOString() };
}

/** Pure: release the lock (on PR merge/close, AC-17/AC-21, or stale-lock reconciliation, AC-22). */
export function releaseSurface(state: ReviewState): ReviewState {
  if (state.reviewSurface === null) return state;
  return { ...state, reviewSurface: null, updatedAt: new Date().toISOString() };
}

// ── Conflict defer (NLSpec 0002 D-12): /defer leaves a conflict unresolved and blocks merge ─────

/** Pure: mark a conflict `/defer`red (AC-24). Clears any prior accept/reject so it is genuinely
 *  unresolved, and adds it to the merge-blocking set. Idempotent. */
export function deferConflict(state: ReviewState, claimId: string): ReviewState {
  const { [claimId]: _dropped, ...rest } = state.conflictResolutions;
  void _dropped;
  return {
    ...state,
    conflictResolutions: rest,
    deferredConflicts: state.deferredConflicts.includes(claimId)
      ? state.deferredConflicts
      : [...state.deferredConflicts, claimId],
    updatedAt: new Date().toISOString(),
  };
}

/** Pure: clear a defer (e.g. a later `/keep`/`/replace` re-resolves it — AC-24 last-write-wins). */
export function clearDefer(state: ReviewState, claimId: string): ReviewState {
  if (!state.deferredConflicts.includes(claimId)) return state;
  return {
    ...state,
    deferredConflicts: state.deferredConflicts.filter((c) => c !== claimId),
    updatedAt: new Date().toISOString(),
  };
}

/** A session is mergeable only when no conflict is `/defer`red (NLSpec 0002 D-12, AC-24). */
export function isMergeable(state: ReviewState): boolean {
  return state.deferredConflicts.length === 0;
}

// ── Command idempotency audit (NLSpec 0002 §7, AC-13) ───────────────────────────────────────────

/** Has this PR comment already been processed into a resolution? (Idempotent polling.) */
export function isCommentProcessed(state: ReviewState, commentId: string): boolean {
  return commentId in state.processedComments;
}

/** Pure: record that a comment was processed and what resolution it produced (durable audit). */
export function recordProcessedComment(
  state: ReviewState,
  commentId: string,
  resolution: string,
): ReviewState {
  return {
    ...state,
    processedComments: { ...state.processedComments, [commentId]: resolution },
    updatedAt: new Date().toISOString(),
  };
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
