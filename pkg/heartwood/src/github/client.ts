export type CommitAction =
  | { action: 'create' | 'update'; filePath: string; content: string }
  | { action: 'delete'; filePath: string }
  | { action: 'move';   filePath: string; previousPath: string; content?: string };

export interface ProjectInfo {
  defaultBranch: string;
  webUrl:        string;
}

export interface PullRequestResult {
  number: number;
  webUrl: string;
}

export interface DiscussionNote {
  id:       number;
  body:     string;
  author:   { username: string };
  position: {
    position_type: string;
    new_path:      string;
    new_line:      number | null;
    old_line:      number | null;
  } | null;
}

export interface Discussion {
  id:              string;
  individual_note: boolean;
  notes:           DiscussionNote[];
}

export interface GitHubClient {
  getProject():     Promise<ProjectInfo>;
  branchExists(name: string): Promise<boolean>;
  createBranch(name: string, from: string): Promise<void>;
  commitFiles(branch: string, actions: CommitAction[], message: string): Promise<string>;
  createPullRequest(opts: {
    title:      string;
    body:       string;
    headBranch: string;
    baseBranch: string;
  }): Promise<PullRequestResult>;
  createReviewComment(prNumber: number, opts: {
    body:     string;
    commitId: string;
    path:     string;
    line:     number;
  }): Promise<{ discussionId: string }>;
  listDiscussions(prNumber: number): Promise<Discussion[]>;
  addDiscussionNote(prNumber: number, discussionId: string, body: string): Promise<void>;
  addIssueComment(prNumber: number, body: string): Promise<void>;
}

// ---- GitHub REST raw response shapes ----

interface GitRef {
  object: { sha: string };
}

interface ReviewComment {
  id:             number;
  body:           string;
  user:           { login: string };
  path:           string;
  line:           number | null;
  in_reply_to_id: number | undefined;
  created_at:     string;
}

export function createClient(apiUrl: string, token: string, repo: string): GitHubClient {
  const baseUrl = `${apiUrl}/repos/${repo}`;
  const headers = {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type':         'application/json',
  };

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Bound the response body: this message is surfaced to recordError() and
      // persisted into the committed ledger, so don't let a large/unexpected
      // body bloat (or smuggle request context into) version control.
      const snippet = text.length > 500 ? `${text.slice(0, 500)}… (truncated)` : text;
      throw new Error(`GitHub API ${method} ${path} failed (${res.status}): ${snippet}`);
    }
    return res.json();
  }

  return {
    async getProject() {
      const data = await request('GET', '') as { default_branch: string; html_url: string };
      return { defaultBranch: data.default_branch, webUrl: data.html_url };
    },
    async branchExists(name) {
      const res = await fetch(
        `${baseUrl}/git/ref/heads/${name}`,
        { headers },
      );
      if (res.status === 404) return false;
      if (res.ok) return true;
      throw new Error(`branchExists check failed (${res.status})`);
    },
    async createBranch(name, from) {
      const ref = await request('GET', `/git/ref/heads/${from}`) as GitRef;
      await request('POST', '/git/refs', {
        ref: `refs/heads/${name}`,
        sha: ref.object.sha,
      });
    },
    async commitFiles(branch, actions, message) {
      // Atomic multi-file commit via the Git Data API:
      //   branch ref → base commit → base tree → new tree → new commit → move ref.
      const branchRef = await request('GET', `/git/ref/heads/${branch}`) as GitRef;
      const baseSha = branchRef.object.sha;
      const baseCommit = await request('GET', `/git/commits/${baseSha}`) as { tree: { sha: string } };
      const baseTreeSha = baseCommit.tree.sha;

      // A move without content is a pure rename: preserve the source blob by
      // reusing its sha rather than writing an empty file. Resolve those shas
      // from the base tree (fetched once, recursively, and only when needed).
      const blobShaByPath = new Map<string, string>();
      if (actions.some((a) => a.action === 'move' && a.content === undefined)) {
        const recursed = await request('GET', `/git/trees/${baseTreeSha}?recursive=1`) as {
          tree: Array<{ path: string; sha: string; type: string }>;
        };
        for (const e of recursed.tree) if (e.type === 'blob') blobShaByPath.set(e.path, e.sha);
      }

      // Build tree entries. create/update/move(new path) add a blob; delete and a
      // move's previous path are removed via { path, sha: null }.
      const tree: Array<Record<string, unknown>> = [];
      for (const a of actions) {
        if (a.action === 'delete') {
          tree.push({ path: a.filePath, mode: '100644', type: 'blob', sha: null });
          continue;
        }
        if (a.action === 'move') {
          tree.push({ path: a.previousPath, mode: '100644', type: 'blob', sha: null });
          if (a.content !== undefined) {
            tree.push({ path: a.filePath, mode: '100644', type: 'blob', content: a.content });
          } else {
            const sha = blobShaByPath.get(a.previousPath);
            if (!sha) {
              throw new Error(`move: cannot rename ${a.previousPath} — not found in base tree and no content provided`);
            }
            tree.push({ path: a.filePath, mode: '100644', type: 'blob', sha });
          }
          continue;
        }
        tree.push({ path: a.filePath, mode: '100644', type: 'blob', content: a.content });
      }

      const newTree = await request('POST', '/git/trees', {
        base_tree: baseTreeSha,
        tree,
      }) as { sha: string };

      const newCommit = await request('POST', '/git/commits', {
        message,
        tree:    newTree.sha,
        parents: [baseSha],
      }) as { sha: string };

      await request('PATCH', `/git/refs/heads/${branch}`, { sha: newCommit.sha });

      return newCommit.sha;
    },
    async createPullRequest({ title, body, headBranch, baseBranch }) {
      const data = await request('POST', '/pulls', {
        title,
        body,
        head: headBranch,
        base: baseBranch,
      }) as { number: number; html_url: string };
      return { number: data.number, webUrl: data.html_url };
    },
    async createReviewComment(prNumber, { body, commitId, path, line }) {
      const data = await request('POST', `/pulls/${prNumber}/comments`, {
        body,
        commit_id: commitId,
        path,
        line,
        side: 'RIGHT',
      }) as { id: number };
      return { discussionId: String(data.id) };
    },
    async listDiscussions(prNumber) {
      const raw: ReviewComment[] = [];
      let page = 1;
      while (true) {
        const batch = await request(
          'GET', `/pulls/${prNumber}/comments?per_page=100&page=${page}`,
        ) as ReviewComment[];
        raw.push(...batch);
        if (batch.length < 100) break;
        page++;
      }
      return reconstructThreads(raw);
    },
    async addDiscussionNote(prNumber, discussionId, body) {
      await request(
        'POST',
        `/pulls/${prNumber}/comments/${discussionId}/replies`,
        { body },
      );
    },
    async addIssueComment(prNumber, body) {
      // PR-level (non-inline) comment, used to surface notes that couldn't be
      // anchored to a diff line.
      await request('POST', `/issues/${prNumber}/comments`, { body });
    },
  };
}

// Reconstruct PR review-comment threads from a flat list. A root comment has no
// in_reply_to_id; every reply (directly or transitively) chains back to a root.
// Each thread becomes a Discussion whose id is the root comment id; the root
// note carries diff position, replies carry position: null.
function reconstructThreads(comments: ReviewComment[]): Discussion[] {
  const byId = new Map<number, ReviewComment>();
  for (const c of comments) byId.set(c.id, c);

  // Resolve each comment to its thread root id by walking in_reply_to_id.
  function rootOf(c: ReviewComment): number {
    let cur = c;
    const seen = new Set<number>();
    while (cur.in_reply_to_id !== undefined && byId.has(cur.in_reply_to_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.in_reply_to_id)!;
    }
    return cur.id;
  }

  const threads = new Map<number, ReviewComment[]>();
  for (const c of comments) {
    const root = rootOf(c);
    if (!threads.has(root)) threads.set(root, []);
    threads.get(root)!.push(c);
  }

  const discussions: Discussion[] = [];
  for (const [rootId, members] of threads) {
    members.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const notes: DiscussionNote[] = members.map((c, i) => ({
      id:     c.id,
      body:   c.body,
      author: { username: c.user.login },
      position: i === 0
        ? {
            position_type: 'text',
            new_path:      c.path,
            new_line:      c.line ?? null,
            old_line:      null,
          }
        : null,
    }));
    discussions.push({ id: String(rootId), individual_note: false, notes });
  }

  return discussions;
}
