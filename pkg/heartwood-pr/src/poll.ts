// pollOnce (NLSpec 0002 §6.2 "bot: poll"; AC-5/AC-13/AC-14/AC-24/AC-26). One IDEMPOTENT poll tick:
// run on a timer (cron/systemd), it can be called any number of times and only ever applies a comment
// once (processed-id audit) — so a crash is just a skipped tick, and commands posted while the bot was
// offline are caught up on the next tick (AC-13/AC-27c). Pure over its DI'd deps (fake-tested).
//
// Two passes: (1) reviewer COMMANDS on conflict comments → the shared ledger; (2) reviewer CHECKBOX
// edits in the PR body → per-proposal rejections. The ledger is authoritative throughout (AC-26).

import {
  acquireSurface,
  applyDecision,
  clearConflictNote,
  clearStaleApproval,
  isCommentProcessed,
  recordConflictNote,
  recordProcessedComment,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import { applyCommand, parseCommand } from './command';
import { diffCheckboxState, parseConflictMarker } from './markers';
import type { BotDeps } from './deps';

export interface PollOk {
  ok: true;
  commandsApplied: number;
  /** Comments ignored (non-allowlisted author, or a command not bindable to a known conflict). */
  ignored: number;
  unchecks: number;
  rechecks: number;
  /** ProposalIds whose prose a resolution changed — fed to redraftBatch (AC-6/AC-12). */
  redraftPages: string[];
}
export interface PollNoop {
  ok: false;
  reason: string;
}
export type PollResult = PollOk | PollNoop;

export async function pollOnce(sid: SessionId, deps: BotDeps): Promise<PollResult> {
  let state: ReviewState = await deps.ledger.read(sid);
  const link = state.reviewSurface;
  if (!link || link.surface !== 'pr' || link.prNumber === undefined) {
    return { ok: false, reason: `no open PR linkage for ${sid.arc}@${sid.date}` };
  }
  const prNumber = link.prNumber;

  const pr = await deps.gh.prView(prNumber);
  if (pr.state !== 'OPEN') return { ok: false, reason: `PR #${prNumber} is ${pr.state}` };

  const artifact = await deps.artifacts.read(sid);
  if (!artifact) return { ok: false, reason: `session ${sid.arc}@${sid.date} not ingested` };

  // claimId → proposalId (which page a resolution re-drafts), and the set of real conflict claims.
  const claimToProposal = new Map<string, string>();
  for (const p of artifact.proposals) for (const f of p.facts) claimToProposal.set(f.claimId, p.id);
  const validConflictClaims = new Set(artifact.conflicts.map((c) => c.claimId));

  const redraftPages = new Set<string>();
  let commandsApplied = 0;
  let ignored = 0;

  // ── Pass 1: commands on conflict comments ──────────────────────────────────────────────────────
  for (const cm of await deps.gh.listComments(prNumber)) {
    if (isCommentProcessed(state, cm.id)) continue; // idempotent (AC-13)
    if (cm.authorLogin !== deps.reviewerLogin) continue; // only the allowlisted reviewer (D-3/AC-14)
    const parsed = parseCommand(cm.body);
    if (!parsed.command) continue; // a non-command reviewer comment is ignored (left unprocessed so a
    // later edit-to-add-a-command is still picked up — GitHub keeps the comment id across edits)

    const claimId = parseConflictMarker(cm.body);
    if (!claimId || !validConflictClaims.has(claimId)) {
      // A command not bindable to a known conflict (AC-24): acknowledge confusion + don't reapply.
      await deps.gh.addReaction(cm.id, 'confused');
      state = recordProcessedComment(state, cm.id, 'ignored:unbound');
      await deps.ledger.write(sid, state); // durable before the next comment's side-effects
      ignored++;
      continue;
    }

    await deps.gh.addReaction(cm.id, 'eyes'); // 👀 picked up
    const applied = applyCommand(state, claimId, parsed.command);
    state = applied.state;
    state =
      parsed.command.kind === 'merge'
        ? recordConflictNote(state, claimId, parsed.command.note)
        : clearConflictNote(state, claimId);
    state = recordProcessedComment(state, cm.id, applied.resolution);
    // Reconcile the commanded page on the branch. We flag it regardless of the narrow `redraft`
    // heuristic: the open draft asserted ALL of the page's facts, so any resolution can change its
    // effective prose set (incl. dropping the page entirely) — redraftBatch decides write vs remove.
    const pid = claimToProposal.get(claimId);
    if (pid) redraftPages.add(pid);
    // Persist the audit + resolution NOW (AC-13): a crash before the next comment must not re-apply
    // this one. Idempotent polling depends on processedComments being durable per command.
    await deps.ledger.write(sid, state);
    await deps.gh.addReaction(cm.id, 'rocket'); // ✅≈🚀 applied
    commandsApplied++;
  }

  // ── Pass 2: checkbox edits in the PR body (AC-26) ──────────────────────────────────────────────
  let unchecks = 0;
  let rechecks = 0;
  for (const ch of diffCheckboxState(link.lastSeenPrBody ?? '', pr.body)) {
    // The branch must reflect the new approved set (AC-26/AC-8): an uncheck removes the page, a
    // re-check restores it — both reconcile in redraftBatch.
    redraftPages.add(ch.proposalId);
    if (ch.checked) {
      // Re-checking re-approves the page AND clears any "re-read, this changed" flag (AC-11).
      state = applyDecision(state, { proposalId: ch.proposalId, decision: 'approved' });
      state = clearStaleApproval(state, ch.proposalId);
      rechecks++;
    } else {
      state = applyDecision(state, { proposalId: ch.proposalId, decision: 'rejected' });
      unchecks++;
    }
  }

  // Reconcile the checkbox-diff baseline to the body we just read (don't re-detect the same edit).
  const relinked = acquireSurface(state, { ...link, lastSeenPrBody: pr.body });
  if (relinked) state = relinked;

  await deps.ledger.write(sid, state);
  return { ok: true, commandsApplied, ignored, unchecks, rechecks, redraftPages: [...redraftPages] };
}
