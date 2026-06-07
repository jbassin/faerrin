// Narrative-led PR body generator (NLSpec 0002 §6.1/§6.2; AC-1/AC-2/AC-3/AC-16/AC-26).
//
// This is what retires the three original PR-tool failures BY CONSTRUCTION:
//  - failure #3 (no narrative) → the body LEADS with the in-voice recap, then events → pages.
//  - failure #2 (wrong surface) → prose is shown RENDERED (sanitizer-safe) with a deploy-preview
//    link, never as a `+/-` diff (diffs are demoted to the Files tab).
//  - failure #1 (review burden) → ONE PR, event-grouped (collapsible), clean pages are PRE-CHECKED
//    checkboxes the reviewer only unchecks where something's wrong (review by subtraction); trivial
//    edits collapse under a count.
//
// PURE: (artifact, ledger, +optional drafted prose/preview URLs) → a Markdown string. No GitHub, no
// LLM, no jj. The bot supplies the in-voice `drafts` (from `draftProse`) and `previewUrls`; this
// module only assembles + makes everything sanitizer-safe and marker-bound.

import type { SessionArtifact } from '@faerrin/heartwood/src/state/store';
import { decisionFor, type ReviewState } from '@faerrin/heartwood/src/state/review';
import { groupProposalsByEvent } from '@faerrin/heartwood-review/src/lib/event-groups';
import { conflictMarker, proposalMarker } from './markers';
import { toSanitizerSafe } from './render-safe';

type Proposal = SessionArtifact['proposals'][number];
type Conflict = SessionArtifact['conflicts'][number];

/**
 * A top-level conflict comment (NLSpec 0002 §5 glossary, AC-5): the existing statement, the new
 * statement, the explanation/context, the command menu, and an invisible `hw:conflict` marker
 * binding it to its claim (AC-13). Sanitizer-safe throughout. The bot posts one per conflict.
 */
export function buildConflictComment(c: Conflict): string {
  return [
    `**Canon conflict — ${toSanitizerSafe(c.canonicalName)}**`,
    '',
    `> **Existing canon:** ${toSanitizerSafe(c.existingStatement)}`,
    `> **This session says:** ${toSanitizerSafe(c.newStatement)}`,
    '',
    toSanitizerSafe(c.explanation),
    `_(source: ${toSanitizerSafe(c.sourceRef)})_`,
    '',
    'Reply with **one** — `/keep` (keep existing canon) · `/replace` (take the new fact) · ' +
      '`/merge <note>` (accept, conditioned on your note) · `/defer` (resolve later in the workbench — blocks merge).',
    conflictMarker(c.claimId),
  ].join('\n');
}

export interface PrBodyInput {
  artifact: SessionArtifact;
  /** The shared ledger — authoritative for checkbox state (a rejected proposal renders unchecked). */
  state: ReviewState;
  /** In-voice drafted passage per proposalId (from `draftProse` at open/redraft time). Missing ⇒
   *  fall back to the proposal's cited facts so the body is never empty. */
  drafts?: Record<string, string>;
  /** Per-page deploy-preview URL (AC-2/AC-18, the faithful read). Missing ⇒ link omitted. */
  previewUrls?: Record<string, string>;
}

/**
 * A "trivial edit" (glossary, AC-16): a low-substance amend (a single mention/date addition) that is
 * auto-collapsed under a count. Heuristic: an amend carrying exactly one fact. Creates and
 * multi-fact amends are always substantive.
 */
export function isTrivial(p: Proposal): boolean {
  return p.kind === 'amend' && p.facts.length === 1;
}

/** Conflict claimIds touching a proposal's page (by entity) — the per-claim mechanism (AC-25). */
function conflictsForProposal(artifact: SessionArtifact, p: Proposal): string[] {
  return artifact.conflicts.filter((c) => c.entityId === p.entityId).map((c) => c.claimId);
}

/** The prose to show for a page: the in-voice draft if we have one, else its cited facts. */
function proseFor(p: Proposal, drafts: Record<string, string>): string {
  const draft = drafts[p.id]?.trim();
  if (draft) return toSanitizerSafe(draft);
  // Fallback: the cited facts, as a readable list (still sanitizer-safe).
  return toSanitizerSafe(p.facts.map((f) => `- ${f.text}`).join('\n'));
}

/** Indent multi-line prose as a Markdown blockquote nested under a checkbox list item. */
function asNestedQuote(prose: string): string {
  return prose
    .split('\n')
    .map((line) => `  > ${line}`.trimEnd())
    .join('\n');
}

function renderProposal(input: PrBodyInput, p: Proposal): string {
  const { artifact, state, drafts = {}, previewUrls = {} } = input;
  // The ledger is authoritative for check state (AC-26): a rejected page renders unchecked.
  const checked = decisionFor(state, p.id) === 'rejected' ? ' ' : 'x';
  const conflictIds = conflictsForProposal(artifact, p);
  const kindTag = p.kind === 'create' ? 'new page' : 'amend';

  const lineBits = [`- [${checked}] **${p.canonicalName}**`, `_(${kindTag})_`];
  if (conflictIds.length > 0) {
    lineBits.push('⚠️ canon conflict — resolve in the thread below');
  }
  const preview = previewUrls[p.id];
  if (preview) lineBits.push(`· [preview ↗](${preview})`);
  lineBits.push(proposalMarker(p.id));

  return [lineBits.join(' '), asNestedQuote(proseFor(p, drafts))].join('\n');
}

function eventTitle(proposals: Proposal[]): string {
  return proposals.map((p) => p.canonicalName).join(' · ');
}

/**
 * Assemble the full story-first PR body (AC-1). Structure: counts header → recap → per-event
 * collapsible sections (substantive pages expanded, trivial edits collapsed under a count).
 */
export function buildPrBody(input: PrBodyInput): string {
  const { artifact } = input;
  const { proposals, conflicts, narrative, sessionId } = artifact;

  // Event grouping by citation overlap (AC-16, reuse). Map ids back to proposals, input order.
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const groups = groupProposalsByEvent(proposals).map((ids) =>
    ids.map((id) => byId.get(id)!).filter(Boolean),
  );

  const header =
    `**Session \`${sessionId.arc}\` @ ${sessionId.date}** — ` +
    `${proposals.length} page${proposals.length === 1 ? '' : 's'} · ` +
    `${groups.length} event${groups.length === 1 ? '' : 's'} · ` +
    `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`;

  const recap = narrative.trim()
    ? toSanitizerSafe(narrative)
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n')
    : '> _(no recap)_';

  const sections: string[] = [];
  groups.forEach((group, i) => {
    const substantive = group.filter((p) => !isTrivial(p));
    const trivial = group.filter(isTrivial);

    const parts: string[] = [`### Event ${i + 1} — ${eventTitle(group)}`];
    for (const p of substantive) parts.push(renderProposal(input, p));

    if (trivial.length > 0) {
      const count = trivial.length;
      parts.push(
        '',
        `<details><summary>${count} trivial edit${count === 1 ? '' : 's'}</summary>`,
        '',
        ...trivial.map((p) => renderProposal(input, p)),
        '',
        '</details>',
      );
    }
    sections.push(parts.join('\n'));
  });

  const body = [
    header,
    '',
    recap,
    '',
    '---',
    '',
    sections.length > 0 ? sections.join('\n\n') : '_No proposed edits in this session._',
    '',
    '---',
    '_The branch is the draft; **merging is the act of authorship**. Uncheck any page whose change is wrong; nothing reaches the live wiki until you merge._',
  ].join('\n');

  return body;
}
