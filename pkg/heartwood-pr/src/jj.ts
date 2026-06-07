// The VCS seam (NLSpec 0002 §8, C3, AC-9, D-15). The session branch is a jj BOOKMARK
// `hw/<arc>-<date>`; all branch ops go through jj (NEVER raw git — it corrupts colocated jj state).
// A small DI interface so the bot's branch logic is fake-testable, with a real execFile impl (the
// gated boundary) and an in-memory `FakeJj`.
//
// Two load-bearing facts this encodes:
//  - **Additive only** (AC-9): pushes add jj revisions; the bot never force-pushes away the
//    reviewer's own branch commits. (Enforced by callers building additive revisions, not here.)
//  - **bookmarkTarget is the jj-aware human-edit discriminator** (AC-10, D-14): the bot remembers the
//    target it last pushed (`lastBotBookmarkTarget` in the ledger); if the live bookmark target
//    differs, the reviewer hand-edited the branch and a re-draft must SKIP that page — NOT a git SHA
//    (jj churns SHAs on every push), the *bookmark target* is the stable signal.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The minimal jj surface the bot needs (branch lifecycle + canonizer cleanup). */
export interface JjClient {
  /** Create or move a bookmark to a revision (default the just-committed `@-`). */
  bookmarkSet(name: string, revision?: string): Promise<void>;
  /** The commit id a bookmark points to, or null if it doesn't exist (the AC-10 discriminator). */
  bookmarkTarget(name: string): Promise<string | null>;
  /** Push a bookmark additively (`jj git push -b <name> --allow-new`). */
  gitPush(bookmark: string): Promise<void>;
  /** Fetch remote refs (the canonizer detects a remote squash-merge after this — D-15). */
  gitFetch(): Promise<void>;
  /** Delete a local bookmark (canonizer cleanup after merge). */
  bookmarkDelete(name: string): Promise<void>;
  /** Abandon revisions (canonizer drops the now-merged local branch revs — D-15). */
  abandon(revset: string): Promise<void>;
  /** Content-relative paths changed between two revisions — the per-page human-edit detector
   *  (AC-10): the files in `from..to` that the bot didn't write are the reviewer's hand-edits. */
  changedPaths(from: string, to: string): Promise<string[]>;
}

// ── Real implementation (the gated boundary — never exercised in tests) ──────────────────────────

export interface JjRunner {
  (args: string[]): Promise<string>;
}

function defaultRun(cwd: string): JjRunner {
  return async (args: string[]) => {
    const { stdout } = await execFileAsync('jj', ['--no-pager', ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
}

/** Real jj client over execFile. A real run mutates the repo / hits the remote — Phase-C gated. */
export function makeJjClient(cwd: string = process.cwd(), run: JjRunner = defaultRun(cwd)): JjClient {
  return {
    async bookmarkSet(name, revision = '@-') {
      // `jj bookmark set` creates-or-moves (idempotent); `--allow-backwards` not needed (we go forward).
      await run(['bookmark', 'set', name, '-r', revision]);
    },
    async bookmarkTarget(name) {
      try {
        const out = (await run(['log', '-r', name, '--no-graph', '-T', 'commit_id.short()'])).trim();
        return out || null;
      } catch {
        return null; // unknown bookmark → no target
      }
    },
    async gitPush(bookmark) {
      await run(['git', 'push', '-b', bookmark, '--allow-new']);
    },
    async gitFetch() {
      await run(['git', 'fetch']);
    },
    async bookmarkDelete(name) {
      await run(['bookmark', 'delete', name]);
    },
    async abandon(revset) {
      await run(['abandon', revset]);
    },
    async changedPaths(from, to) {
      // `jj diff --from <from> --to <to> --summary` → lines like "M path", "A path"; take the path.
      const out = await run(['diff', '--from', from, '--to', to, '--summary']);
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^[A-Z]\s+/, ''));
    },
  };
}

// ── In-memory fake (the test double for branch logic) ────────────────────────────────────────────

/**
 * In-memory `JjClient` for tests. Tracks bookmark targets, pushes, fetches, deletes, and abandons so
 * a step test can assert "the bot pushed bookmark X at revision R additively" with no real jj. The
 * `simulateHumanCommit` helper plays a reviewer hand-editing the branch (moving the bookmark target
 * to one the bot didn't push) to exercise the AC-10 clobber guard.
 */
export class FakeJj implements JjClient {
  private bookmarks = new Map<string, string>();
  readonly pushes: { bookmark: string; target: string }[] = [];
  readonly fetches: { id: number }[] = [];
  readonly deleted: string[] = [];
  readonly abandoned: string[] = [];
  private fetchCount = 0;

  async bookmarkSet(name: string, revision = '@-'): Promise<void> {
    this.bookmarks.set(name, revision);
  }
  async bookmarkTarget(name: string): Promise<string | null> {
    return this.bookmarks.get(name) ?? null;
  }
  async gitPush(bookmark: string): Promise<void> {
    const target = this.bookmarks.get(bookmark);
    if (target === undefined) throw new Error(`cannot push unknown bookmark ${bookmark}`);
    this.pushes.push({ bookmark, target });
  }
  async gitFetch(): Promise<void> {
    this.fetches.push({ id: ++this.fetchCount });
  }
  async bookmarkDelete(name: string): Promise<void> {
    this.bookmarks.delete(name);
    this.deleted.push(name);
  }
  async abandon(revset: string): Promise<void> {
    this.abandoned.push(revset);
  }
  async changedPaths(from: string, to: string): Promise<string[]> {
    return [...(this.humanPaths.get(`${from}..${to}`) ?? [])];
  }

  private humanPaths = new Map<string, string[]>();

  // — reviewer simulation (test-only) —
  /** Reviewer pushes a hand-edit to the branch (AC-10): moves the bookmark to `newTarget` and
   *  records the pages they changed between `fromBotTarget` and `newTarget`. */
  simulateHumanEdit(bookmark: string, fromBotTarget: string, newTarget: string, paths: string[]): void {
    this.bookmarks.set(bookmark, newTarget);
    this.humanPaths.set(`${fromBotTarget}..${newTarget}`, paths);
  }
  /** Reviewer pushes their own commit to the branch: the bookmark target moves to one the bot didn't
   *  push, so a later `bookmarkTarget` ≠ the ledger's `lastBotBookmarkTarget` (AC-10 trips). */
  simulateHumanCommit(bookmark: string, newTarget: string): void {
    this.bookmarks.set(bookmark, newTarget);
  }
  /** The current target of a bookmark (test assertions). */
  targetOf(bookmark: string): string | null {
    return this.bookmarks.get(bookmark) ?? null;
  }
}
