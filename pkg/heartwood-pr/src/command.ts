// PR-comment command grammar (NLSpec 0002 §6.4, D-7; AC-5/AC-24/AC-25).
//
// The ONLY input grammar that drives canon changes is a fixed four-word vocabulary the reviewer
// replies on a conflict comment with: `/keep`, `/replace`, `/merge <note>`, `/defer`. Free text is
// fed to the LLM ONLY inside `/merge <note>` (scoped, low-risk) — replacing the original fragile
// free-text `approve <instructions>`. Commands act per-CLAIM (a page may carry other approved facts
// whose checkbox is unaffected — §6.4 granularity, AC-25); clean-proposal checkboxes are separate.
//
// This module is PURE: `parseCommand` is text→intent; `applyCommand` is (ledger, claimId, intent)→
// ledger. The bot's I/O shell binds the comment to its claimId via the `hw:conflict` marker
// (markers.ts), gates on author allowlist (D-3), and acks 👀→✅ — none of that lives here.

import {
  applyConflictResolution,
  conflictResolutionFor,
  deferConflict,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';

export const COMMAND_KINDS = ['keep', 'replace', 'merge', 'defer'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export type Command =
  | { kind: 'keep' }
  | { kind: 'replace' }
  | { kind: 'merge'; note: string }
  | { kind: 'defer' };

export interface ParsedCommand {
  /** The honored command — the FIRST one in the body — or `null` if the body has no command. */
  command: Command | null;
  /** Additional commands found beyond the first; >0 means the bot should flag "only the first was
   *  honored" (AC-24 "multiple commands in one comment → only the first is honored, rest flagged"). */
  ignoredExtras: number;
  /** True when a `/merge` with an empty note was degraded to `/replace` (AC-24). Informational. */
  degradedEmptyMerge: boolean;
}

// A command token at a word boundary: line-start or whitespace, then `/kind`, then a boundary.
// The leading boundary avoids matching inside URLs (`http://host/keep`). `merge` captures the rest
// of its line as the note. Global + multiline so we can find every command and honor the first.
const COMMAND_RE = /(?:^|\s)\/(keep|replace|merge|defer)\b([^\n]*)/gi;

/**
 * Parse a reviewer's PR-comment body into at most one honored command (NLSpec 0002 D-7, AC-24).
 * Returns `command: null` for a comment that carries no command (it is simply ignored upstream —
 * "a command on a non-conflict comment is ignored" is enforced by the caller via the claim marker).
 */
export function parseCommand(body: string): ParsedCommand {
  const matches = [...body.matchAll(COMMAND_RE)];
  if (matches.length === 0) return { command: null, ignoredExtras: 0, degradedEmptyMerge: false };

  const first = matches[0]!;
  const kind = first[1]!.toLowerCase() as CommandKind;
  const trailing = (first[2] ?? '').trim();
  const ignoredExtras = matches.length - 1;

  if (kind === 'merge') {
    // `/merge` with an empty note degrades to `/replace` (AC-24): a conditioned re-draft with no
    // condition is just a re-draft.
    if (trailing.length === 0) {
      return { command: { kind: 'replace' }, ignoredExtras, degradedEmptyMerge: true };
    }
    return { command: { kind: 'merge', note: trailing }, ignoredExtras, degradedEmptyMerge: false };
  }
  return { command: { kind }, ignoredExtras, degradedEmptyMerge: false };
}

export interface ApplyResult {
  /** The ledger after applying the command (pure — caller persists it). */
  state: ReviewState;
  /** The resolution this produced, for the processed-comment audit (AC-13). */
  resolution: 'accepted' | 'rejected' | 'deferred';
  /**
   * Whether the affected page must be re-drafted (AC-6/AC-12). True only when the page's effective
   * fact set actually changed: newly accepting/rejecting a fact, or a `/merge` whose note may
   * re-condition prose. A duplicate command that doesn't change the resolution is idempotent and
   * needs no re-draft (AC-24).
   */
  redraft: boolean;
  /** Draft instructions carried by `/merge <note>` — conditions the re-draft (AC-6). */
  instructions?: string;
}

/**
 * Map a parsed command onto the shared ledger for one conflicting `claimId` (NLSpec 0002 §6.4):
 * `/keep`→Reject the claim (drop its fact; page keeps existing canon); `/replace`/`/merge`→Accept
 * (the page becomes a correction, re-drafted); `/defer`→leave unresolved + block merge (D-12).
 * Last write wins on re-resolution (AC-24).
 */
export function applyCommand(state: ReviewState, claimId: string, command: Command): ApplyResult {
  const wasAccepted = conflictResolutionFor(state, claimId) === 'accepted';

  switch (command.kind) {
    case 'keep':
      return {
        state: applyConflictResolution(state, claimId, 'rejected'),
        resolution: 'rejected',
        // Re-draft only if we are REMOVING a fact the page had already accepted (and thus drafted).
        redraft: wasAccepted,
      };
    case 'replace':
      return {
        state: applyConflictResolution(state, claimId, 'accepted'),
        resolution: 'accepted',
        // Newly accepting changes the page; a duplicate /replace on an already-accepted claim is a no-op.
        redraft: !wasAccepted,
      };
    case 'merge':
      return {
        state: applyConflictResolution(state, claimId, 'accepted'),
        resolution: 'accepted',
        // The note may re-condition the prose even when the claim was already accepted.
        redraft: true,
        instructions: command.note,
      };
    case 'defer':
      return {
        state: deferConflict(state, claimId),
        resolution: 'deferred',
        // Deferring removes a previously-accepted fact from the page; else no prose change.
        redraft: wasAccepted,
      };
  }
}
