// Invisible binding markers + checkbox-state diffing (NLSpec 0002 §7; AC-13/AC-26).
//
// The bot must bind GitHub artifacts to ledger identities WITHOUT relying on GitHub's own thread
// position or state — a force-push can mark threads "outdated", and comment order is not stable.
// So every binding is carried in an HTML comment, which GitHub renders as nothing (invisible to the
// reviewer) but survives in the raw body the bot reads back:
//   - a conflict comment carries `<!-- hw:conflict <claimId> -->`  → which claim a `/command` resolves
//   - a clean-proposal checkbox line carries `<!-- hw:proposal <proposalId> -->` → which page an
//     uncheck rejects (AC-26)
//
// This module is PURE: it formats markers, extracts ids from raw text, and diffs two PR-body
// revisions into per-proposal checkbox changes. The polling/threading lives in the I/O shell.

export const CONFLICT_MARKER = 'hw:conflict';
export const PROPOSAL_MARKER = 'hw:proposal';

/** The invisible marker that binds a conflict comment to its claim (AC-13). */
export function conflictMarker(claimId: string): string {
  return `<!-- ${CONFLICT_MARKER} ${claimId} -->`;
}

/** The invisible marker that binds a clean-proposal checkbox to its proposal (AC-26). */
export function proposalMarker(proposalId: string): string {
  return `<!-- ${PROPOSAL_MARKER} ${proposalId} -->`;
}

function markerRe(kind: string): RegExp {
  // Tolerant of whitespace; ids are non-space tokens (proposalId/claimId never contain spaces).
  return new RegExp(`<!--\\s*${kind}\\s+(\\S+)\\s*-->`);
}

/** Extract the claimId a conflict comment is bound to, or null if it carries no conflict marker. */
export function parseConflictMarker(text: string): string | null {
  return markerRe(CONFLICT_MARKER).exec(text)?.[1] ?? null;
}

/** Extract the proposalId a line/marker is bound to, or null. */
export function parseProposalMarker(text: string): string | null {
  return markerRe(PROPOSAL_MARKER).exec(text)?.[1] ?? null;
}

// A GitHub task-list checkbox: `- [ ]` (unchecked) or `- [x]` (checked, case-insensitive).
const CHECKBOX_RE = /^\s*[-*]\s+\[([ xX])\]/;

/**
 * Map every clean-proposal checkbox in a PR body to its checked state, keyed by proposalId. A line
 * counts only if it is BOTH a task checkbox AND carries an `hw:proposal` marker (so prose, headings,
 * and stray checkboxes are ignored). Later occurrences of a proposalId win (defensive; the body
 * generator emits one per proposal).
 */
export function parseCheckboxStates(body: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const line of body.split('\n')) {
    const box = CHECKBOX_RE.exec(line);
    if (!box) continue;
    const proposalId = parseProposalMarker(line);
    if (proposalId === null) continue;
    out.set(proposalId, box[1] !== ' ');
  }
  return out;
}

/**
 * Patch a single proposal's checkbox in a PR body in place: set its checked state and optionally
 * insert a `note` (idempotently) before its marker. Used by the re-draft pass to auto-uncheck +
 * flag a page whose approved prose changed (AC-11), without re-rendering (and thus needing) every
 * other page's prose. Lines that aren't this proposal's checkbox are returned verbatim.
 */
export function setCheckboxInBody(
  body: string,
  proposalId: string,
  checked: boolean,
  note?: string,
): string {
  const marker = proposalMarker(proposalId);
  return body
    .split('\n')
    .map((line) => {
      if (!CHECKBOX_RE.test(line) || parseProposalMarker(line) !== proposalId) return line;
      let out = line.replace(CHECKBOX_RE, (m, c: string) => m.replace(`[${c}]`, `[${checked ? 'x' : ' '}]`));
      if (note && !out.includes(note)) {
        out = out.includes(marker) ? out.replace(marker, `${note} ${marker}`) : `${out} ${note}`;
      }
      return out;
    })
    .join('\n');
}

export interface CheckboxChange {
  proposalId: string;
  /** The checkbox's new state after the reviewer's edit. `false` ⇒ an uncheck ⇒ reject (AC-26). */
  checked: boolean;
}

/**
 * Diff two PR-body revisions into per-proposal checkbox changes (AC-26). Only proposals whose state
 * actually flipped are returned. An uncheck (`checked:false`) is the reviewer rejecting that page's
 * change; a re-check (`checked:true`) reverses it. Proposals present in only one revision are
 * ignored (the proposal set changed, not the checkbox — handled by re-ingest reconciliation, AC-20).
 */
export function diffCheckboxState(oldBody: string, newBody: string): CheckboxChange[] {
  const before = parseCheckboxStates(oldBody);
  const after = parseCheckboxStates(newBody);
  const changes: CheckboxChange[] = [];
  for (const [proposalId, checked] of after) {
    if (!before.has(proposalId)) continue;
    if (before.get(proposalId) !== checked) changes.push({ proposalId, checked });
  }
  return changes;
}
