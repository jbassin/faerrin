// The GitHub seam (NLSpec 0002 §4 "GitHub", D-1). A SMALL typed interface the bot depends on, with
// two implementations: a real one over `gh`/`gh api` (gh 2.4.0 — porcelain for create/view/edit,
// `gh api` for reactions, comment ids, PR-body PATCH), and an in-memory `FakeGh` so every bot step
// is unit-testable with no network. All real shell-outs use execFile (fixed argv, no shell), like
// the review app's jj usage. `gh` infers owner/repo from the repo cwd; `gh api` substitutes
// `{owner}`/`{repo}`, so no explicit repo plumbing is needed.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** A GitHub reaction content. NB: GitHub has NO checkmark reaction, so the bot's "done/✅" ack maps
 *  to `rocket`; `eyes` (👀) means "picked up". (NLSpec 0002 AC-5 ack handshake.) */
export type ReactionContent = 'eyes' | 'rocket' | '+1' | 'hooray' | 'confused';

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface PrView {
  number: number;
  state: PrState;
  /** ISO timestamp the PR was merged, or null if never merged (the canonizer's local trigger). */
  mergedAt: string | null;
  body: string;
  headRefName: string;
}

export interface PrComment {
  /** GitHub issue-comment id (stable, force-push-proof) — the idempotency key (AC-13). */
  id: string;
  authorLogin: string;
  body: string;
}

export interface PrCreateOpts {
  head: string;
  base: string;
  title: string;
  body: string;
}

/** The minimal GitHub surface the bot needs. Kept small — only what the steps call. */
export interface GhClient {
  /** Open a PR for an already-pushed head branch; returns its number. */
  prCreate(opts: PrCreateOpts): Promise<number>;
  /** Read PR state/body/head (state+mergedAt drive the merge-canonizer; body drives checkbox diff). */
  prView(prNumber: number): Promise<PrView>;
  /** Replace the PR body (AC-26 re-render / auto-uncheck). */
  updateBody(prNumber: number, body: string): Promise<void>;
  /** Post a top-level PR comment (the bot's conflict comments, AC-5); returns the new comment id. */
  postComment(prNumber: number, body: string): Promise<string>;
  /** All top-level PR (issue) comments, oldest first — polled for commands (AC-5/AC-13). */
  listComments(prNumber: number): Promise<PrComment[]>;
  /** React on a comment (the 👀→rocket ack handshake, AC-5). */
  addReaction(commentId: string, content: ReactionContent): Promise<void>;
  /** Open PRs whose head is `head` — for one-PR-per-session enforcement (AC-27a). */
  prListByHead(head: string): Promise<PrView[]>;
}

// ── Real implementation (the gated boundary — never exercised in tests) ──────────────────────────

export interface GhRunner {
  (args: string[]): Promise<string>;
}

function defaultRun(cwd: string): GhRunner {
  return async (args: string[]) => {
    const { stdout } = await execFileAsync('gh', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
}

/**
 * Real `gh` client. `run` is injectable so the argv it builds can be asserted without a live gh, but
 * a real run hits GitHub — that is the worldbuilder-gated boundary (Phase C). Arg construction is
 * pure and could be unit-tested; we deliberately don't, to keep the test suite network-free.
 */
export function makeGhClient(cwd: string = process.cwd(), run: GhRunner = defaultRun(cwd)): GhClient {
  return {
    async prCreate(opts) {
      // `gh pr create` prints the new PR URL; the number is its last path segment.
      const url = (
        await run(['pr', 'create', '--head', opts.head, '--base', opts.base, '--title', opts.title, '--body', opts.body])
      ).trim();
      const num = Number(url.split('/').pop());
      if (!Number.isInteger(num)) throw new Error(`could not parse PR number from: ${url}`);
      return num;
    },
    async prView(prNumber) {
      const out = await run(['pr', 'view', String(prNumber), '--json', 'number,state,mergedAt,body,headRefName']);
      const j = JSON.parse(out) as { number: number; state: string; mergedAt: string | null; body: string; headRefName: string };
      return { number: j.number, state: j.state as PrState, mergedAt: j.mergedAt, body: j.body, headRefName: j.headRefName };
    },
    async updateBody(prNumber, body) {
      await run(['pr', 'edit', String(prNumber), '--body', body]);
    },
    async postComment(prNumber, body) {
      // Use the API so we get the created comment's id back (porcelain `gh pr comment` doesn't return it).
      const out = await run(['api', '-X', 'POST', `repos/{owner}/{repo}/issues/${prNumber}/comments`, '-f', `body=${body}`, '--jq', '.id']);
      return out.trim();
    },
    async listComments(prNumber) {
      const out = await run([
        'api', '--paginate', `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        '--jq', '.[] | {id: .id, authorLogin: .user.login, body: .body}',
      ]);
      // --jq with an array stream yields one JSON object per line.
      return out
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          const o = JSON.parse(l) as { id: number; authorLogin: string; body: string };
          return { id: String(o.id), authorLogin: o.authorLogin, body: o.body };
        });
    },
    async addReaction(commentId, content) {
      await run(['api', '-X', 'POST', `repos/{owner}/{repo}/issues/comments/${commentId}/reactions`, '-f', `content=${content}`]);
    },
    async prListByHead(head) {
      const out = await run(['pr', 'list', '--head', head, '--state', 'open', '--json', 'number,state,mergedAt,body,headRefName']);
      const arr = JSON.parse(out) as { number: number; state: string; mergedAt: string | null; body: string; headRefName: string }[];
      return arr.map((j) => ({ number: j.number, state: j.state as PrState, mergedAt: j.mergedAt, body: j.body, headRefName: j.headRefName }));
    },
  };
}

// ── In-memory fake (the test double every bot step runs against) ─────────────────────────────────

interface FakePr {
  number: number;
  state: PrState;
  mergedAt: string | null;
  body: string;
  headRefName: string;
  base: string;
  title: string;
  comments: PrComment[];
  reactions: Map<string, Set<ReactionContent>>;
}

/**
 * In-memory `GhClient` for tests. Beyond the interface it exposes `simulate*` helpers to play the
 * REVIEWER (post a command comment, edit the body's checkboxes, merge/close the PR) — so a step test
 * can drive a full round-trip with no network. Reaction state is observable via `reactionsOn`.
 */
export class FakeGh implements GhClient {
  private prs = new Map<number, FakePr>();
  private nextPr = 1;
  private nextComment = 1000;

  async prCreate(opts: PrCreateOpts): Promise<number> {
    const number = this.nextPr++;
    this.prs.set(number, {
      number,
      state: 'OPEN',
      mergedAt: null,
      body: opts.body,
      headRefName: opts.head,
      base: opts.base,
      title: opts.title,
      comments: [],
      reactions: new Map(),
    });
    return number;
  }
  async prView(prNumber: number): Promise<PrView> {
    const pr = this.get(prNumber);
    return { number: pr.number, state: pr.state, mergedAt: pr.mergedAt, body: pr.body, headRefName: pr.headRefName };
  }
  async updateBody(prNumber: number, body: string): Promise<void> {
    this.get(prNumber).body = body;
  }
  async postComment(prNumber: number, body: string): Promise<string> {
    const id = String(this.nextComment++);
    this.get(prNumber).comments.push({ id, authorLogin: 'heartwood-bot', body });
    return id;
  }
  async listComments(prNumber: number): Promise<PrComment[]> {
    return [...this.get(prNumber).comments];
  }
  async addReaction(commentId: string, content: ReactionContent): Promise<void> {
    for (const pr of this.prs.values()) {
      if (pr.comments.some((c) => c.id === commentId)) {
        const set = pr.reactions.get(commentId) ?? new Set();
        set.add(content);
        pr.reactions.set(commentId, set);
        return;
      }
    }
    throw new Error(`no such comment ${commentId}`);
  }
  async prListByHead(head: string): Promise<PrView[]> {
    return [...this.prs.values()]
      .filter((p) => p.headRefName === head && p.state === 'OPEN')
      .map((p) => ({ number: p.number, state: p.state, mergedAt: p.mergedAt, body: p.body, headRefName: p.headRefName }));
  }

  // — reviewer simulation (test-only) —
  /** Reviewer posts a top-level comment (e.g. a `/keep` reply). Returns the new comment id. */
  simulateComment(prNumber: number, authorLogin: string, body: string): string {
    const id = String(this.nextComment++);
    this.get(prNumber).comments.push({ id, authorLogin, body });
    return id;
  }
  /** Reviewer edits the PR body (e.g. unchecks a checkbox). */
  simulateBodyEdit(prNumber: number, body: string): void {
    this.get(prNumber).body = body;
  }
  /** Reviewer merges the PR (the remote act the canonizer detects locally). */
  simulateMerge(prNumber: number, at = '2026-06-06T12:00:00.000Z'): void {
    const pr = this.get(prNumber);
    pr.state = 'MERGED';
    pr.mergedAt = at;
  }
  /** Reviewer closes the PR without merging (AC-17 discard). */
  simulateClose(prNumber: number): void {
    this.get(prNumber).state = 'CLOSED';
  }
  /** Observe the reactions on a comment (assert the 👀→rocket ack). */
  reactionsOn(commentId: string): ReactionContent[] {
    for (const pr of this.prs.values()) {
      const set = pr.reactions.get(commentId);
      if (set) return [...set];
    }
    return [];
  }

  private get(prNumber: number): FakePr {
    const pr = this.prs.get(prNumber);
    if (!pr) throw new Error(`no such PR #${prNumber}`);
    return pr;
  }
}
