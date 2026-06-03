import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { createClient } from './client';
import type { Server } from 'bun';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyServer = Server<any>;

// Minimal test server to intercept fetch calls without importing any frameworks.
let server: AnyServer;
let lastRequest: { method: string; url: string; body: unknown } | null = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = req.headers.get('content-type')?.includes('application/json')
        ? await req.json().catch(() => null)
        : null;
      lastRequest = { method: req.method, url: req.url, body };
      const { status, body: respBody } = nextResponse;
      return new Response(JSON.stringify(respBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
});

afterAll(() => {
  server.stop();
});

function makeClient(projectId = 'my/project') {
  return createClient(`http://localhost:${server.port}`, 'test-token', projectId);
}

function setResponse(status: number, body: unknown) {
  nextResponse = { status, body };
}

describe('getProject', () => {
  test('maps default_branch and web_url', async () => {
    setResponse(200, { default_branch: 'main', web_url: 'https://gitlab.example.com/ns/proj' });
    const client = makeClient();
    const info = await client.getProject();
    expect(info.defaultBranch).toBe('main');
    expect(info.webUrl).toBe('https://gitlab.example.com/ns/proj');
    expect(lastRequest?.method).toBe('GET');
  });
});

describe('branchExists', () => {
  test('returns true on 200', async () => {
    setResponse(200, { name: 'wiki/foo' });
    const client = makeClient();
    expect(await client.branchExists('wiki/foo')).toBe(true);
  });

  test('returns false on 404', async () => {
    setResponse(404, { message: '404 Branch Not Found' });
    const client = makeClient();
    expect(await client.branchExists('wiki/nonexistent')).toBe(false);
  });

  test('throws on 500', async () => {
    setResponse(500, { message: 'Internal Server Error' });
    const client = makeClient();
    await expect(client.branchExists('wiki/foo')).rejects.toThrow('branchExists check failed (500)');
  });
});

describe('createBranch', () => {
  test('throws with GitLab message on non-2xx', async () => {
    setResponse(422, { message: 'Branch already exists' });
    const client = makeClient();
    await expect(client.createBranch('wiki/foo', 'main')).rejects.toThrow('422');
  });

  test('posts correct body', async () => {
    setResponse(201, { name: 'wiki/foo' });
    const client = makeClient();
    await client.createBranch('wiki/foo', 'main');
    expect(lastRequest?.body).toMatchObject({ branch: 'wiki/foo', ref: 'main' });
  });
});

describe('commitFiles', () => {
  test('serializes file_path (not filePath) and encoding: text', async () => {
    setResponse(201, { id: 'abc' });
    const client = makeClient();
    await client.commitFiles('wiki/foo', [
      { action: 'update', filePath: 'content/Geography/Hallia/index.md', content: '# Hello' },
    ], 'wiki: integrate foo');
    const body = lastRequest?.body as Record<string, unknown>;
    expect(body.branch).toBe('wiki/foo');
    expect(body.commit_message).toBe('wiki: integrate foo');
    const actions = body.actions as Array<Record<string, unknown>>;
    expect(actions[0]).toMatchObject({
      action: 'update',
      file_path: 'content/Geography/Hallia/index.md',
      content: '# Hello',
      encoding: 'text',
    });
    expect((actions[0] as Record<string, unknown>).filePath).toBeUndefined();
  });

  test('serializes delete action without content or encoding', async () => {
    setResponse(201, { id: 'abc' });
    const client = makeClient();
    await client.commitFiles('wiki/foo', [
      { action: 'delete', filePath: 'content/Old.md' },
    ], 'wiki: delete old');
    const actions = (lastRequest?.body as Record<string, unknown>).actions as Array<Record<string, unknown>>;
    expect(actions[0]).toEqual({ action: 'delete', file_path: 'content/Old.md' });
    expect(actions[0]!.content).toBeUndefined();
  });

  test('serializes move action with previous_path', async () => {
    setResponse(201, { id: 'abc' });
    const client = makeClient();
    await client.commitFiles('wiki/foo', [
      { action: 'move', filePath: 'content/New.md', previousPath: 'content/Old.md', content: '# New' },
    ], 'wiki: rename');
    const actions = (lastRequest?.body as Record<string, unknown>).actions as Array<Record<string, unknown>>;
    expect(actions[0]).toMatchObject({
      action: 'move',
      file_path: 'content/New.md',
      previous_path: 'content/Old.md',
      content: '# New',
      encoding: 'text',
    });
  });
});

describe('createMergeRequest', () => {
  test('returns iid and webUrl from response', async () => {
    setResponse(201, { iid: 42, web_url: 'https://gitlab.example.com/ns/proj/-/merge_requests/42' });
    const client = makeClient();
    const result = await client.createMergeRequest({
      title: 'Wiki: Test',
      description: '## Summary',
      sourceBranch: 'wiki/foo',
      targetBranch: 'main',
    });
    expect(result.iid).toBe(42);
    expect(result.webUrl).toBe('https://gitlab.example.com/ns/proj/-/merge_requests/42');
  });
});

describe('createDiscussion', () => {
  test('posts to discussions endpoint and returns discussionId', async () => {
    setResponse(201, { id: 'disc-abc', notes: [] });
    const client = makeClient();
    const result = await client.createDiscussion(42, 'Speculative claim');
    expect(lastRequest?.url).toContain('/merge_requests/42/discussions');
    expect(lastRequest?.body).toMatchObject({ body: 'Speculative claim' });
    expect(result.discussionId).toBe('disc-abc');
  });
});

describe('listDiscussions', () => {
  test('returns single page when fewer than 100 results', async () => {
    const discussions = [{ id: 'd1', individual_note: false, notes: [] }];
    setResponse(200, discussions);
    const client = makeClient();
    const result = await client.listDiscussions(42);
    expect(result).toHaveLength(1);
    expect(lastRequest?.url).toContain('/merge_requests/42/discussions');
    expect(lastRequest?.url).toContain('per_page=100');
    expect(lastRequest?.url).toContain('page=1');
  });

  test('fetches multiple pages and merges results', async () => {
    // Fake a two-page scenario: first call returns 100 items, second returns 1
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`, individual_note: false, notes: [],
    }));
    const page2 = [{ id: 'last', individual_note: false, notes: [] }];
    let callCount = 0;
    server.stop();
    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = req.headers.get('content-type')?.includes('application/json')
          ? await req.json().catch(() => null)
          : null;
        lastRequest = { method: req.method, url: req.url, body };
        callCount++;
        const resp = callCount === 1 ? page1 : page2;
        return new Response(JSON.stringify(resp), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const client = createClient(`http://localhost:${server.port}`, 'test-token', 'my/project');
    const result = await client.listDiscussions(1);
    expect(result).toHaveLength(101);
    expect(callCount).toBe(2);
    // Restore simple server
    server.stop();
    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = req.headers.get('content-type')?.includes('application/json')
          ? await req.json().catch(() => null)
          : null;
        lastRequest = { method: req.method, url: req.url, body };
        const { status, body: respBody } = nextResponse;
        return new Response(JSON.stringify(respBody), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
  });
});

describe('addDiscussionNote', () => {
  test('posts reply to correct discussion endpoint', async () => {
    setResponse(201, { id: 99 });
    const client = makeClient();
    await client.addDiscussionNote(42, 'disc-xyz', 'Applied.');
    expect(lastRequest?.url).toContain('/merge_requests/42/discussions/disc-xyz/notes');
    expect(lastRequest?.body).toMatchObject({ body: 'Applied.' });
  });

  test('URL-encodes discussion ID with slashes', async () => {
    setResponse(201, { id: 99 });
    const client = makeClient();
    await client.addDiscussionNote(1, 'a/b', 'ok');
    expect(lastRequest?.url).toContain(encodeURIComponent('a/b'));
  });
});

describe('projectId encoding', () => {
  test('encodes namespace/project slash in URL', async () => {
    setResponse(200, { default_branch: 'main', web_url: 'https://gitlab.example.com/ns/proj' });
    const client = createClient(`http://localhost:${server.port}`, 'tok', 'my-group/my-project');
    await client.getProject();
    expect(lastRequest?.url).toContain(encodeURIComponent('my-group/my-project'));
  });
});
