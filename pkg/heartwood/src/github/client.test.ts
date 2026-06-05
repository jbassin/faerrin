import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'bun:test';
import { createClient } from './client';
import type { Server } from 'bun';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyServer = Server<any>;

// GitHub client methods make multi-step request sequences (commitFiles issues
// five calls; createBranch two; listDiscussions paginates), so the mock server
// dispatches on method+path rather than replaying a single canned response.
interface Captured { method: string; path: string; url: string; body: unknown }
type Route = (method: string, path: string, body: unknown) => { status: number; body: unknown };

let server: AnyServer;
let requests: Captured[] = [];
let route: Route = () => ({ status: 200, body: {} });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = req.headers.get('content-type')?.includes('application/json')
        ? await req.json().catch(() => null)
        : null;
      const path = new URL(req.url).pathname + new URL(req.url).search;
      requests.push({ method: req.method, path, url: req.url, body });
      const { status, body: respBody } = route(req.method, new URL(req.url).pathname, body);
      return new Response(JSON.stringify(respBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
});

afterAll(() => server.stop());

beforeEach(() => {
  requests = [];
  route = () => ({ status: 200, body: {} });
});

function makeClient(repo = 'owner/repo') {
  return createClient(`http://localhost:${server.port}`, 'test-token', repo);
}

const last = () => requests[requests.length - 1]!;

describe('getProject', () => {
  test('maps default_branch and html_url → webUrl', async () => {
    route = () => ({ status: 200, body: { default_branch: 'main', html_url: 'https://github.com/owner/repo' } });
    const info = await makeClient().getProject();
    expect(info.defaultBranch).toBe('main');
    expect(info.webUrl).toBe('https://github.com/owner/repo');
    expect(last().method).toBe('GET');
    expect(last().path).toBe('/repos/owner/repo');
  });

  test('does NOT URL-encode the owner/repo slash', async () => {
    route = () => ({ status: 200, body: { default_branch: 'main', html_url: 'x' } });
    await createClient(`http://localhost:${server.port}`, 'tok', 'my-org/my-repo').getProject();
    expect(last().path).toBe('/repos/my-org/my-repo');
  });
});

describe('branchExists', () => {
  test('returns true on 200', async () => {
    route = () => ({ status: 200, body: { ref: 'refs/heads/wiki/foo' } });
    expect(await makeClient().branchExists('wiki/foo')).toBe(true);
    expect(last().path).toBe('/repos/owner/repo/git/ref/heads/wiki/foo');
  });

  test('returns false on 404', async () => {
    route = () => ({ status: 404, body: { message: 'Not Found' } });
    expect(await makeClient().branchExists('wiki/nope')).toBe(false);
  });

  test('throws on 500', async () => {
    route = () => ({ status: 500, body: { message: 'boom' } });
    await expect(makeClient().branchExists('wiki/foo')).rejects.toThrow('branchExists check failed (500)');
  });
});

describe('createBranch', () => {
  test('resolves the source ref then posts refs/heads with its sha', async () => {
    route = (method, path) => {
      if (method === 'GET' && path.endsWith('/git/ref/heads/main')) {
        return { status: 200, body: { object: { sha: 'base-sha' } } };
      }
      return { status: 201, body: { ref: 'refs/heads/wiki/foo' } };
    };
    await makeClient().createBranch('wiki/foo', 'main');
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.path).toBe('/repos/owner/repo/git/refs');
    expect(post.body).toMatchObject({ ref: 'refs/heads/wiki/foo', sha: 'base-sha' });
  });

  test('throws with status on non-2xx', async () => {
    route = (method, path) => {
      if (method === 'GET') return { status: 200, body: { object: { sha: 's' } } };
      return { status: 422, body: { message: 'Reference already exists' } };
    };
    await expect(makeClient().createBranch('wiki/foo', 'main')).rejects.toThrow('422');
  });
});

describe('commitFiles (Git Data API)', () => {
  function commitRoutes(): Route {
    return (method, path) => {
      if (method === 'GET' && path.endsWith('/git/ref/heads/wiki/foo')) {
        return { status: 200, body: { object: { sha: 'base-commit' } } };
      }
      if (method === 'GET' && path.endsWith('/git/commits/base-commit')) {
        return { status: 200, body: { tree: { sha: 'base-tree' } } };
      }
      if (method === 'POST' && path.endsWith('/git/trees')) {
        return { status: 201, body: { sha: 'new-tree' } };
      }
      if (method === 'POST' && path.endsWith('/git/commits')) {
        return { status: 201, body: { sha: 'new-commit' } };
      }
      if (method === 'PATCH' && path.endsWith('/git/refs/heads/wiki/foo')) {
        return { status: 200, body: {} };
      }
      return { status: 500, body: { message: `unexpected ${method} ${path}` } };
    };
  }

  test('walks ref→commit→tree→commit→ref and returns the new commit sha', async () => {
    route = commitRoutes();
    const sha = await makeClient().commitFiles('wiki/foo', [
      { action: 'update', filePath: 'content/Hallia.md', content: '# Hello' },
    ], 'wiki: integrate foo');
    expect(sha).toBe('new-commit');

    const treeReq = requests.find((r) => r.path.endsWith('/git/trees'))!;
    const treeBody = treeReq.body as Record<string, unknown>;
    expect(treeBody.base_tree).toBe('base-tree');
    const entries = treeBody.tree as Array<Record<string, unknown>>;
    expect(entries[0]).toEqual({ path: 'content/Hallia.md', mode: '100644', type: 'blob', content: '# Hello' });

    const commitReq = requests.find((r) => r.method === 'POST' && r.path.endsWith('/git/commits'))!;
    expect(commitReq.body).toMatchObject({ message: 'wiki: integrate foo', tree: 'new-tree', parents: ['base-commit'] });

    const patchReq = requests.find((r) => r.method === 'PATCH')!;
    expect(patchReq.path).toBe('/repos/owner/repo/git/refs/heads/wiki/foo');
    expect(patchReq.body).toMatchObject({ sha: 'new-commit' });
  });

  test('delete action → tree entry with sha:null and no content', async () => {
    route = commitRoutes();
    await makeClient().commitFiles('wiki/foo', [
      { action: 'delete', filePath: 'content/Old.md' },
    ], 'wiki: delete old');
    const entries = (requests.find((r) => r.path.endsWith('/git/trees'))!.body as Record<string, unknown>).tree as Array<Record<string, unknown>>;
    expect(entries[0]).toEqual({ path: 'content/Old.md', mode: '100644', type: 'blob', sha: null });
  });

  test('move action → removes previous path and adds new path with content', async () => {
    route = commitRoutes();
    await makeClient().commitFiles('wiki/foo', [
      { action: 'move', filePath: 'content/New.md', previousPath: 'content/Old.md', content: '# New' },
    ], 'wiki: rename');
    const entries = (requests.find((r) => r.path.endsWith('/git/trees'))!.body as Record<string, unknown>).tree as Array<Record<string, unknown>>;
    expect(entries).toContainEqual({ path: 'content/Old.md', mode: '100644', type: 'blob', sha: null });
    expect(entries).toContainEqual({ path: 'content/New.md', mode: '100644', type: 'blob', content: '# New' });
  });

  test('content-less move reuses the source blob sha (pure rename, no empty file)', async () => {
    route = (method, path) => {
      if (method === 'GET' && path.endsWith('/git/ref/heads/wiki/foo')) return { status: 200, body: { object: { sha: 'base-commit' } } };
      if (method === 'GET' && path.endsWith('/git/commits/base-commit')) return { status: 200, body: { tree: { sha: 'base-tree' } } };
      if (method === 'GET' && path.endsWith('/git/trees/base-tree')) return { status: 200, body: { tree: [
        { path: 'content/Old.md', sha: 'blob-old', type: 'blob' },
      ] } };
      if (method === 'POST' && path.endsWith('/git/trees')) return { status: 201, body: { sha: 'new-tree' } };
      if (method === 'POST' && path.endsWith('/git/commits')) return { status: 201, body: { sha: 'new-commit' } };
      if (method === 'PATCH') return { status: 200, body: {} };
      return { status: 500, body: {} };
    };
    await makeClient().commitFiles('wiki/foo', [
      { action: 'move', filePath: 'content/New.md', previousPath: 'content/Old.md' },
    ], 'wiki: rename');
    const entries = (requests.find((r) => r.method === 'POST' && r.path.endsWith('/git/trees'))!.body as Record<string, unknown>).tree as Array<Record<string, unknown>>;
    expect(entries).toContainEqual({ path: 'content/Old.md', mode: '100644', type: 'blob', sha: null });
    expect(entries).toContainEqual({ path: 'content/New.md', mode: '100644', type: 'blob', sha: 'blob-old' });
  });

  test('content-less move for an unknown source path throws', async () => {
    route = (method, path) => {
      if (method === 'GET' && path.endsWith('/git/ref/heads/wiki/foo')) return { status: 200, body: { object: { sha: 'base-commit' } } };
      if (method === 'GET' && path.endsWith('/git/commits/base-commit')) return { status: 200, body: { tree: { sha: 'base-tree' } } };
      if (method === 'GET' && path.endsWith('/git/trees/base-tree')) return { status: 200, body: { tree: [] } };
      return { status: 500, body: {} };
    };
    await expect(makeClient().commitFiles('wiki/foo', [
      { action: 'move', filePath: 'content/New.md', previousPath: 'content/Missing.md' },
    ], 'm')).rejects.toThrow('cannot rename');
  });
});

describe('request error handling', () => {
  test('truncates a large response body in the thrown message', async () => {
    route = () => ({ status: 422, body: { message: 'x'.repeat(2000) } });
    await expect(makeClient().getProject()).rejects.toThrow('… (truncated)');
    try {
      await makeClient().getProject();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('failed (422)');
      expect(msg.length).toBeLessThan(700);
    }
  });
});

describe('createPullRequest', () => {
  test('posts head/base and returns number + webUrl', async () => {
    route = () => ({ status: 201, body: { number: 42, html_url: 'https://github.com/owner/repo/pull/42' } });
    const result = await makeClient().createPullRequest({
      title: 'Wiki: Test',
      body: '## Summary',
      headBranch: 'wiki/foo',
      baseBranch: 'main',
    });
    expect(result.number).toBe(42);
    expect(result.webUrl).toBe('https://github.com/owner/repo/pull/42');
    expect(last().path).toBe('/repos/owner/repo/pulls');
    expect(last().body).toMatchObject({ title: 'Wiki: Test', body: '## Summary', head: 'wiki/foo', base: 'main' });
  });
});

describe('createReviewComment', () => {
  test('posts an anchored RIGHT-side comment and returns stringified id', async () => {
    route = () => ({ status: 201, body: { id: 555 } });
    const result = await makeClient().createReviewComment(42, {
      body: 'Speculative claim',
      commitId: 'head-sha',
      path: 'content/Foo.md',
      line: 1,
    });
    expect(last().path).toBe('/repos/owner/repo/pulls/42/comments');
    expect(last().body).toMatchObject({ body: 'Speculative claim', commit_id: 'head-sha', path: 'content/Foo.md', line: 1, side: 'RIGHT' });
    expect(result.discussionId).toBe('555');
  });
});

describe('listDiscussions', () => {
  test('reconstructs a thread: root carries position, replies do not', async () => {
    route = () => ({ status: 200, body: [
      { id: 1, body: 'root', user: { login: 'bot' }, path: 'content/Foo.md', line: 3, in_reply_to_id: undefined, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, body: 'approve', user: { login: 'human' }, path: 'content/Foo.md', line: 3, in_reply_to_id: 1, created_at: '2026-01-02T00:00:00Z' },
    ] });
    const result = await makeClient().listDiscussions(42);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('1');
    expect(result[0]!.notes).toHaveLength(2);
    expect(result[0]!.notes[0]!.body).toBe('root');
    expect(result[0]!.notes[0]!.position).toMatchObject({ position_type: 'text', new_path: 'content/Foo.md', new_line: 3, old_line: null });
    expect(result[0]!.notes[1]!.body).toBe('approve');
    expect(result[0]!.notes[1]!.position).toBeNull();
    expect(last().path).toContain('/repos/owner/repo/pulls/42/comments');
    expect(last().url).toContain('per_page=100');
  });

  test('paginates: 100 then 1 → 2 threads across 2 requests', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, body: `c${i}`, user: { login: 'u' }, path: 'p', line: 1, in_reply_to_id: undefined, created_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
    }));
    const page2 = [{ id: 999, body: 'last', user: { login: 'u' }, path: 'p', line: 1, in_reply_to_id: undefined, created_at: '2026-02-01T00:00:00Z' }];
    route = (_m, path) => {
      const page = new URLSearchParams(requests[requests.length - 1]?.url.split('?')[1] ?? '').get('page');
      return { status: 200, body: path.includes('comments') && page === '2' ? page2 : page1 };
    };
    const result = await makeClient().listDiscussions(7);
    expect(result).toHaveLength(101);
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
  });
});

describe('addDiscussionNote', () => {
  test('posts a reply to the thread root comment', async () => {
    route = () => ({ status: 201, body: { id: 99 } });
    await makeClient().addDiscussionNote(42, '555', 'Applied.');
    expect(last().path).toBe('/repos/owner/repo/pulls/42/comments/555/replies');
    expect(last().body).toMatchObject({ body: 'Applied.' });
  });
});

describe('addIssueComment', () => {
  test('posts a PR-level (non-inline) issue comment', async () => {
    route = () => ({ status: 201, body: { id: 7 } });
    await makeClient().addIssueComment(42, 'fallback note');
    expect(last().path).toBe('/repos/owner/repo/issues/42/comments');
    expect(last().body).toMatchObject({ body: 'fallback note' });
  });
});
