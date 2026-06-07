import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeSessionArtifact } from '@faerrin/heartwood/src/state/store';
import { readPageProvenance } from '@faerrin/heartwood/src/state/provenance';
import { makeVerifyBuild, makeWriteBranch, type BranchWriteDeps } from './bot-impl';
import { makeArtifact, makeProposal, SID } from './test-fixtures';

let root: string;
let wikiDir: string;
let provRoot: string;
let sessionsDir: string;
const commits: string[][] = [];

async function writePage(rel: string, content: string) {
  const abs = join(wikiDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

function deps(over: Partial<BranchWriteDeps> = {}): BranchWriteDeps {
  return {
    wikiDir,
    provRoot,
    sessionsDir,
    base: 'main',
    readBaseFile: async () => null,
    runJj: async (args) => {
      commits.push(args);
      if (args[0] === 'log') return 'rev-abc123';
      return '';
    },
    ...over,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hw-botimpl-'));
  wikiDir = join(root, 'wiki');
  provRoot = join(root, 'prov');
  sessionsDir = join(root, 'sessions');
  await mkdir(wikiDir, { recursive: true });
  await mkdir(provRoot, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  commits.length = 0;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('makeWriteBranch — write path', () => {
  it('weaves an amend passage into the page, writes the sidecar, and makes one jj commit', async () => {
    await writePage('A.md', '---\naliases: [A]\n---\nOriginal body.\n');
    await writeSessionArtifact(sessionsDir, makeArtifact({
      proposals: [makeProposal({ id: 'prop:a', canonicalName: 'A', targetPath: 'A.md', facts: [
        { claimId: 'c1', text: 'a cited fact', citations: [{ transcript: 't', start: 1, end: 1 }], modality: 'gm-stated' },
      ] })],
    }));
    const base = '---\naliases: [A]\n---\nOriginal body.\n';

    const write = makeWriteBranch(deps({ readBaseFile: async (p) => (p === 'A.md' ? base : null) }));
    const res = await write(SID, [{ proposalId: 'prop:a', prose: 'A woven sentence.' }]);

    const page = await readFile(join(wikiDir, 'A.md'), 'utf8');
    expect(page).toContain('aliases: [A]'); // frontmatter preserved
    expect(page).toContain('Original body.');
    expect(page).toContain('A woven sentence.'); // passage appended
    const prov = await readPageProvenance(provRoot, 'A.md');
    expect(prov.records.length).toBeGreaterThan(0);
    expect(res.revision).toBe('rev-abc123');
    // exactly one path-scoped `jj commit ... <files>` (no committedAt write)
    expect(commits[0]![0]).toBe('commit');
    expect(commits[0]).toContain('pkg/content/wiki/A.md');
  });

  it('redrafts rebuild from base (no stacking) and replace this session\'s provenance', async () => {
    await writePage('A.md', '---\n---\nBase.\n');
    await writeSessionArtifact(sessionsDir, makeArtifact({
      proposals: [makeProposal({ id: 'prop:a', canonicalName: 'A', targetPath: 'A.md', facts: [
        { claimId: 'c1', text: 'fact', citations: [{ transcript: 't', start: 1, end: 1 }], modality: 'gm-stated' },
      ] })],
    }));
    const write = makeWriteBranch(deps({ readBaseFile: async () => '---\n---\nBase.\n' }));

    await write(SID, [{ proposalId: 'prop:a', prose: 'First draft.' }]);
    await write(SID, [{ proposalId: 'prop:a', prose: 'Second draft.' }]);
    const page = await readFile(join(wikiDir, 'A.md'), 'utf8');
    expect(page).toContain('Second draft.');
    expect(page).not.toContain('First draft.'); // rebuilt from base, not stacked
    const prov = await readPageProvenance(provRoot, 'A.md');
    // only the latest session pass's records remain (stripped before re-adding)
    expect(prov.records.every((r) => r.session.date === SID.date)).toBe(true);
  });

  it('creates a new page', async () => {
    await writeSessionArtifact(sessionsDir, makeArtifact({
      proposals: [makeProposal({ id: 'prop:n', canonicalName: 'NewPlace', kind: 'create', status: 'new', targetPath: null, facts: [
        { claimId: 'c1', text: 'fact', citations: [{ transcript: 't', start: 1, end: 1 }], modality: 'gm-stated' },
      ] })],
    }));
    const write = makeWriteBranch(deps());
    await write(SID, [{ proposalId: 'prop:n', prose: 'A new place by the river.' }]);
    expect(await readFile(join(wikiDir, 'NewPlace.md'), 'utf8')).toContain('A new place by the river.');
  });

  it('returns an empty revision when nothing was written', async () => {
    await writeSessionArtifact(sessionsDir, makeArtifact());
    const write = makeWriteBranch(deps());
    const res = await write(SID, []);
    expect(res.revision).toBe('');
    expect(commits.length).toBe(0);
  });
});

describe('makeWriteBranch — remove path (AC-26/AC-8)', () => {
  it('reverts a rejected amend to its base content', async () => {
    await writePage('A.md', '---\n---\nBase.\n\nA woven draft sentence.\n');
    await writeSessionArtifact(sessionsDir, makeArtifact({
      proposals: [makeProposal({ id: 'prop:a', canonicalName: 'A', targetPath: 'A.md' })],
    }));
    const write = makeWriteBranch(deps({ readBaseFile: async () => '---\n---\nBase.\n' }));
    await write(SID, [{ proposalId: 'prop:a', prose: '', action: 'remove' }]);
    expect(await readFile(join(wikiDir, 'A.md'), 'utf8')).toBe('---\n---\nBase.\n');
  });

  it('deletes a rejected create', async () => {
    await writePage('NewPlace.md', 'A new place.\n');
    await writeSessionArtifact(sessionsDir, makeArtifact({
      proposals: [makeProposal({ id: 'prop:n', canonicalName: 'NewPlace', kind: 'create', status: 'new', targetPath: null })],
    }));
    const write = makeWriteBranch(deps());
    await write(SID, [{ proposalId: 'prop:n', prose: '', action: 'remove' }]);
    expect(readFile(join(wikiDir, 'NewPlace.md'), 'utf8')).rejects.toThrow();
  });
});

describe('makeVerifyBuild — the 763-file guard (AC-21)', () => {
  it('passes when only expected pages changed', async () => {
    const verify = makeVerifyBuild({
      runBuild: async () => {},
      changedBuildPaths: async () => ['pkg/aether/public/A/index.html'],
      expectedChanged: async () => ['pkg/aether/public/A/index.html'],
    });
    expect(await verify(SID)).toEqual({ ok: true });
  });

  it('FAILS when an unexpected file changed (blocks canonization)', async () => {
    const verify = makeVerifyBuild({
      runBuild: async () => {},
      changedBuildPaths: async () => ['pkg/aether/public/A/index.html', 'pkg/aether/public/renderer.js'],
      expectedChanged: async () => ['pkg/aether/public/A/index.html'],
    });
    const r = await verify(SID);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('unexpected build file');
  });

  it('FAILS when the build throws', async () => {
    const verify = makeVerifyBuild({
      runBuild: async () => { throw new Error('astro boom'); },
      changedBuildPaths: async () => [],
      expectedChanged: async () => [],
    });
    const r = await verify(SID);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('build failed');
  });
});
