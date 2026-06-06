import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listSessionArtifacts,
  readSessionArtifact,
  writeSessionArtifact,
  type SessionArtifact,
} from './store';

function makeArtifact(over: Partial<SessionArtifact> = {}): SessionArtifact {
  const claim = {
    id: 'c1',
    text: 'Sableclutch hugs the south bank of the Fousan River.',
    citations: [{ transcript: '000.x.2025-08-28.txt', start: 12, end: 14 }],
    speaker: 'Gamemaster',
    role: 'gm' as const,
    modality: 'gm-stated' as const,
    entitySurfaceForms: ['Sableclutch'],
  };
  return {
    sessionId: { arc: 'through-a-song-darkly', date: '2025-08-28' },
    transcript: '000.through-a-song-darkly.2025-8-28.txt',
    contentHash: 'deadbeef',
    generatedAt: '2026-06-06T00:00:00.000Z',
    narrative: 'The party reached Sableclutch.',
    triage: { canon: [claim], uncertain: [], noise: [] },
    proposals: [
      {
        id: 'prop:e1',
        kind: 'amend',
        status: 'existing',
        entityId: 'e1',
        canonicalName: 'Sableclutch',
        targetPath: 'Geography/Calaria/Hallia/Sableclutch/index.md',
        facts: [{ claimId: 'c1', text: claim.text, citations: claim.citations, modality: 'gm-stated' }],
      },
    ],
    entities: [
      {
        id: 'e1',
        canonicalName: 'Sableclutch',
        aliases: ['Sableclutch'],
        wikiPath: 'Geography/Calaria/Hallia/Sableclutch/index.md',
        status: 'known',
        confidence: 'high',
      },
    ],
    needsConfirmation: [],
    conflicts: [],
    ...over,
  };
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'hw-store-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('session artifact store', () => {
  it('round-trips an artifact through write/read', async () => {
    await withTmp(async (dir) => {
      const a = makeArtifact();
      await writeSessionArtifact(dir, a);
      const back = await readSessionArtifact(dir, a.sessionId);
      expect(back).toEqual(a);
    });
  });

  it('returns null for an un-ingested session', async () => {
    await withTmp(async (dir) => {
      const got = await readSessionArtifact(dir, { arc: 'nope', date: '2099-01-01' });
      expect(got).toBeNull();
    });
  });

  it('lists summaries newest-date-first and ignores non-artifacts', async () => {
    await withTmp(async (dir) => {
      await writeSessionArtifact(dir, makeArtifact());
      await writeSessionArtifact(
        dir,
        makeArtifact({ sessionId: { arc: 'fae-and-forest', date: '2025-09-18' } }),
      );
      const list = await listSessionArtifacts(dir);
      expect(list.map((s) => s.sessionId.date)).toEqual(['2025-09-18', '2025-08-28']);
      expect(list[0]!.proposalCount).toBe(1);
    });
  });

  it('rejects a malformed artifact at write (Zod boundary)', async () => {
    await withTmp(async (dir) => {
      const bad = makeArtifact();
      // @ts-expect-error — deliberately invalid kind
      bad.proposals[0]!.kind = 'destroy';
      await expect(writeSessionArtifact(dir, bad)).rejects.toThrow();
    });
  });
});
