export type CommitAction =
  | { action: 'create' | 'update'; filePath: string; content: string }
  | { action: 'delete'; filePath: string }
  | { action: 'move';   filePath: string; previousPath: string; content?: string };

export interface ProjectInfo {
  defaultBranch: string;
  webUrl:        string;
}

export interface MergeRequestResult {
  iid:    number;
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

export interface GitLabClient {
  getProject():     Promise<ProjectInfo>;
  branchExists(name: string): Promise<boolean>;
  createBranch(name: string, from: string): Promise<void>;
  commitFiles(branch: string, actions: CommitAction[], message: string): Promise<void>;
  createMergeRequest(opts: {
    title:        string;
    description:  string;
    sourceBranch: string;
    targetBranch: string;
  }): Promise<MergeRequestResult>;
  createDiscussion(mrIid: number, body: string): Promise<{ discussionId: string }>;
  listDiscussions(mrIid: number): Promise<Discussion[]>;
  addDiscussionNote(mrIid: number, discussionId: string, body: string): Promise<void>;
}

export function createClient(baseUrl: string, token: string, projectId: string): GitLabClient {
  const projectUrl = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${projectUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitLab API ${method} ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  return {
    async getProject() {
      const data = await request('GET', '') as { default_branch: string; web_url: string };
      return { defaultBranch: data.default_branch, webUrl: data.web_url };
    },
    async branchExists(name) {
      const res = await fetch(
        `${projectUrl}/repository/branches/${encodeURIComponent(name)}`,
        { headers },
      );
      if (res.status === 404) return false;
      if (res.ok) return true;
      throw new Error(`branchExists check failed (${res.status})`);
    },
    async createBranch(name, from) {
      await request('POST', '/repository/branches', { branch: name, ref: from });
    },
    async commitFiles(branch, actions, message) {
      await request('POST', '/repository/commits', {
        branch,
        commit_message: message,
        actions: actions.map((a) => {
          if (a.action === 'delete') {
            return { action: 'delete', file_path: a.filePath };
          }
          if (a.action === 'move') {
            return {
              action:        'move',
              file_path:     a.filePath,
              previous_path: a.previousPath,
              content:       a.content,
              encoding:      'text',
            };
          }
          return { action: a.action, file_path: a.filePath, content: a.content, encoding: 'text' };
        }),
      });
    },
    async createMergeRequest({ title, description, sourceBranch, targetBranch }) {
      const data = await request('POST', '/merge_requests', {
        title,
        description,
        source_branch: sourceBranch,
        target_branch: targetBranch,
      }) as { iid: number; web_url: string };
      return { iid: data.iid, webUrl: data.web_url };
    },
    async createDiscussion(mrIid, body) {
      const data = await request(
        'POST', `/merge_requests/${mrIid}/discussions`, { body },
      ) as { id: string };
      return { discussionId: data.id };
    },
    async listDiscussions(mrIid) {
      const results: Discussion[] = [];
      let page = 1;
      while (true) {
        const batch = await request(
          'GET', `/merge_requests/${mrIid}/discussions?per_page=100&page=${page}`,
        ) as Discussion[];
        results.push(...batch);
        if (batch.length < 100) break;
        page++;
      }
      return results;
    },
    async addDiscussionNote(mrIid, discussionId, body) {
      await request(
        'POST',
        `/merge_requests/${mrIid}/discussions/${encodeURIComponent(discussionId)}/notes`,
        { body },
      );
    },
  };
}
