// openSession (NLSpec 0002 §6.2 "bot: open"; AC-1/AC-4/AC-7/AC-27a). Turns an ingested session into
// one PR on a jj bookmark — story-first body, conflict comments, lock acquired. Pure over its DI'd
// deps (fake-tested). The load-bearing ordering: ACQUIRE THE LOCK before any GitHub side-effect, and
// write prose ONLY to the branch (the live wiki is untouched until merge, D-2).

import { acquireSurface, type ReviewState } from '@faerrin/heartwood/src/state/review';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import type { SessionArtifact } from '@faerrin/heartwood/src/state/store';
import { buildConflictComment, buildPrBody } from './pr-body';
import type { BotDeps } from './deps';

export interface OpenOk {
  ok: true;
  prNumber: number;
  branch: string;
  body: string;
}
export interface OpenAborted {
  ok: false;
  reason: string;
}
export type OpenResult = OpenOk | OpenAborted;

/** The PR title = the canonical commit-message subject so a squash merge's default subject matches a
 *  web-app commit's (D-15 message parity). */
export function prTitle(sid: SessionId, artifact: SessionArtifact): string {
  const n = artifact.proposals.length;
  return `heartwood: ${sid.arc} @ ${sid.date} — ${n} page${n === 1 ? '' : 's'}`;
}

export async function openSession(sid: SessionId, deps: BotDeps): Promise<OpenResult> {
  const branch = deps.branchFor(sid);

  // AC-27a: exactly one open PR per session — refuse a second.
  const existing = await deps.gh.prListByHead(branch);
  if (existing.length > 0) {
    return { ok: false, reason: `a PR is already open for ${branch} (#${existing[0]!.number})` };
  }

  const artifact = await deps.artifacts.read(sid);
  if (!artifact) return { ok: false, reason: `session ${sid.arc}@${sid.date} not ingested` };

  // CAS-acquire the lock BEFORE any GitHub side-effect (AC-7). If the web app holds it, abort —
  // never open a PR for a session being reviewed in the workbench.
  let state: ReviewState = await deps.ledger.read(sid);
  const acquired = acquireSurface(state, { surface: 'pr', branch, acquiredAt: deps.now() });
  if (!acquired) return { ok: false, reason: `session ${sid.arc}@${sid.date} is locked by the web app` };
  state = acquired;
  await deps.ledger.write(sid, state); // persist the claim before side-effects (crash-safe lock)

  // Draft in-voice prose for every proposal and write them to the branch as ONE additive revision.
  // committedAt is NOT set here — the live wiki changes only on merge (AC-4/AC-21).
  const drafts: Record<string, string> = {};
  const pages = [];
  for (const p of artifact.proposals) {
    const { draft } = await deps.draft({
      canonicalName: p.canonicalName,
      kind: p.kind,
      facts: p.facts.map((f) => ({ text: f.text })),
    });
    drafts[p.id] = draft;
    pages.push({ proposalId: p.id, prose: draft });
  }
  const { revision } = await deps.writeBranch(sid, pages);

  // Move the session bookmark to the new revision and push it additively (AC-9).
  await deps.jj.bookmarkSet(branch, revision);
  await deps.jj.gitPush(branch);

  // Narrative-led body → open the PR → post one conflict comment per conflict (AC-1/AC-5).
  const body = buildPrBody({ artifact, state, drafts });
  const prNumber = await deps.gh.prCreate({
    head: branch,
    base: deps.base,
    title: prTitle(sid, artifact),
    body,
  });
  for (const c of artifact.conflicts) {
    await deps.gh.postComment(prNumber, buildConflictComment(c));
  }

  // Persist full linkage: PR number, the bot's bookmark target (AC-10 discriminator), and the body
  // we rendered (AC-26 checkbox-diff baseline). Keep the original acquiredAt.
  const linked = acquireSurface(state, {
    surface: 'pr',
    prNumber,
    branch,
    lastBotBookmarkTarget: revision,
    lastSeenPrBody: body,
    acquiredAt: state.reviewSurface!.acquiredAt,
  });
  // acquireSurface only returns null when the OTHER surface holds it; we already hold 'pr', so this
  // is non-null. Guard defensively rather than assert.
  if (linked) {
    state = linked;
    await deps.ledger.write(sid, state);
  }

  return { ok: true, prNumber, branch, body };
}
