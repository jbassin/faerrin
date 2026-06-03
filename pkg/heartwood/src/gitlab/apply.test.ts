import { test, expect, describe, beforeEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { buildCommitActions } from './apply';
import type { CommitAction } from './client';
import type { Proposal } from '../reconcile/propose';

// CommitAction is a discriminated union; only create/update/move carry `content`
// (delete does not). These tests build edit/create/append proposals that always
// yield content-bearing actions, so narrow once here.
function contentOf(action: CommitAction): string {
  if (!('content' in action) || action.content === undefined) {
    throw new Error(`expected a content-bearing action, got '${action.action}'`);
  }
  return action.content;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = `/tmp/heartwood-apply-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(tmpDir, { recursive: true });
});

async function writeFile(relPath: string, content: string) {
  const parts = relPath.split('/');
  const dir = [tmpDir, ...parts.slice(0, -1)].join('/');
  await mkdir(dir, { recursive: true });
  await Bun.write(`${tmpDir}/${relPath}`, content);
}

const ctx = () => ({ contentDir: tmpDir });

describe('edit', () => {
  test('unique oldText succeeds and produces update action', async () => {
    await writeFile('Geography/Hallia/index.md', '# Hallia\n\nOld description.\n');
    const proposals: Proposal[] = [{
      kind: 'edit',
      path: 'Geography/Hallia/index.md',
      oldText: 'Old description.',
      newText: 'New description.',
      citations: [[1, 1]],
    }];
    const actions = await buildCommitActions(proposals, ctx());
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('update');
    expect(actions[0]!.filePath).toBe('content/Geography/Hallia/index.md');
    expect(contentOf(actions[0]!)).toContain('New description.');
    expect(contentOf(actions[0]!)).not.toContain('Old description.');
  });

  test('oldText count 0 → throws', async () => {
    await writeFile('Geography/Hallia/index.md', '# Hallia\n');
    const proposals: Proposal[] = [{
      kind: 'edit',
      path: 'Geography/Hallia/index.md',
      oldText: 'nonexistent text',
      newText: 'replacement',
      citations: [[1, 1]],
    }];
    await expect(buildCommitActions(proposals, ctx())).rejects.toThrow('oldText not found');
  });

  test('oldText count 2 → throws', async () => {
    await writeFile('Geography/Hallia/index.md', 'foo\nfoo\n');
    const proposals: Proposal[] = [{
      kind: 'edit',
      path: 'Geography/Hallia/index.md',
      oldText: 'foo',
      newText: 'bar',
      citations: [[1, 1]],
    }];
    await expect(buildCommitActions(proposals, ctx())).rejects.toThrow('not unique');
  });

  test('two proposals on the same file applied sequentially', async () => {
    await writeFile('Geography/Hallia/index.md', 'Alpha. Beta. Gamma.\n');
    const proposals: Proposal[] = [
      {
        kind: 'edit',
        path: 'Geography/Hallia/index.md',
        oldText: 'Alpha.',
        newText: 'ALPHA.',
        citations: [[1, 1]],
      },
      {
        kind: 'edit',
        path: 'Geography/Hallia/index.md',
        oldText: 'Beta.',
        newText: 'BETA.',
        citations: [[2, 2]],
      },
    ];
    const actions = await buildCommitActions(proposals, ctx());
    expect(actions).toHaveLength(1);
    expect(contentOf(actions[0]!)).toBe('ALPHA. BETA. Gamma.\n');
  });
});

describe('create', () => {
  test('produces create action with correct content', async () => {
    const proposals: Proposal[] = [{
      kind: 'create',
      path: 'Org/NewOrg/index.md',
      content: '# New Org\n\nA new organization.\n',
      citations: [[10, 10]],
    }];
    const actions = await buildCommitActions(proposals, ctx());
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe('create');
    expect(actions[0]!.filePath).toBe('content/Org/NewOrg/index.md');
    expect(contentOf(actions[0]!)).toBe('# New Org\n\nA new organization.\n');
  });

  test('duplicate path (two creates for same file) → throws', async () => {
    const proposals: Proposal[] = [
      {
        kind: 'create',
        path: 'Org/NewOrg/index.md',
        content: '# First\n',
        citations: [[1, 1]],
      },
      {
        kind: 'create',
        path: 'Org/NewOrg/index.md',
        content: '# Second\n',
        citations: [[2, 2]],
      },
    ];
    await expect(buildCommitActions(proposals, ctx())).rejects.toThrow('duplicate path');
  });
});

describe('append', () => {
  test('afterHeading === null appends to file end', async () => {
    await writeFile('Geography/Hallia/index.md', '# Hallia\n\nIntro paragraph.\n');
    const proposals: Proposal[] = [{
      kind: 'append',
      path: 'Geography/Hallia/index.md',
      afterHeading: null,
      content: '### New Section\n\nNew content.',
      citations: [[5, 6]],
    }];
    const actions = await buildCommitActions(proposals, ctx());
    expect(contentOf(actions[0]!)).toBe(
      '# Hallia\n\nIntro paragraph.\n\n### New Section\n\nNew content.',
    );
  });

  test('afterHeading !== null inserts after correct heading', async () => {
    await writeFile('Geography/Hallia/index.md', '# Hallia\n\nIntro.\n\n## Districts\n\nDistrict info.\n\n## Transport\n\nTram info.\n');
    const proposals: Proposal[] = [{
      kind: 'append',
      path: 'Geography/Hallia/index.md',
      afterHeading: 'Districts',
      content: 'Extra district detail.',
      citations: [[3, 3]],
    }];
    const actions = await buildCommitActions(proposals, ctx());
    expect(contentOf(actions[0]!)).toContain('## Districts\n\nExtra district detail.\n\nDistrict info.');
  });

  test('heading not found → throws', async () => {
    await writeFile('Geography/Hallia/index.md', '# Hallia\n\nSome text.\n');
    const proposals: Proposal[] = [{
      kind: 'append',
      path: 'Geography/Hallia/index.md',
      afterHeading: 'Nonexistent Heading',
      content: 'Extra content.',
      citations: [[1, 1]],
    }];
    await expect(buildCommitActions(proposals, ctx())).rejects.toThrow('heading');
  });
});

describe('comment', () => {
  test('comment proposal is skipped (not in output)', async () => {
    const proposals: Proposal[] = [{
      kind: 'comment',
      reason: 'speculative',
      relatedPath: 'Geography/Hallia/index.md',
      message: 'This might be true.',
      citations: [[1, 2]],
    }];
    const actions = await buildCommitActions(proposals, ctx());
    expect(actions).toHaveLength(0);
  });
});
