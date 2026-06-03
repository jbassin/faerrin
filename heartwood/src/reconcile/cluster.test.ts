import { test, expect, describe, mock } from 'bun:test';
import { buildClusters } from './cluster';
import type { ClusterInputs, UpdateCluster, CreateCluster, AliasEditCluster, CommentCluster } from './cluster';
import type { MatchEntry } from './match';
import type { AliasSuggestion } from './resolve';
import type { Claim } from '../transcript/extract';

function makeClaim(
  overrides: Partial<Claim> & { claim?: string; entities?: string[] } = {},
): Claim {
  return {
    claim: overrides.claim ?? 'The sky is blue.',
    lines: overrides.lines ?? [100, 101],
    speaker: 'Gamemaster',
    role: 'gm',
    confidence: overrides.confidence ?? 'stated',
    entities: overrides.entities ?? [],
    sourceSegmentStartLine: 1,
    entityResolutions: overrides.entityResolutions ?? [],
  };
}

function makeEntry(
  claim: Claim,
  candidates: Array<{ path: string | null; relation: 'new' | 'consistent' | 'update' | 'contradict'; rationale?: string; excerpt?: string | null }>,
): MatchEntry {
  return {
    claim,
    candidatePages: candidates.map((c) => ({
      path: c.path,
      relation: c.relation,
      rationale: c.rationale ?? 'some rationale',
      excerpt: c.excerpt ?? null,
    })),
  };
}

describe('update aggregation', () => {
  test('3 update claims for same page → 1 UpdateCluster with 3 entries', () => {
    const path = 'Org/Iconoclasm/index.md';
    const c1 = makeClaim({ claim: 'Claim 1', lines: [100, 100] });
    const c2 = makeClaim({ claim: 'Claim 2', lines: [200, 200] });
    const c3 = makeClaim({ claim: 'Claim 3', lines: [300, 300] });
    const input: ClusterInputs = {
      matches: [
        makeEntry(c1, [{ path, relation: 'update' }]),
        makeEntry(c2, [{ path, relation: 'update' }]),
        makeEntry(c3, [{ path, relation: 'update' }]),
      ],
      aliasSuggestions: [],
      claims: [c1, c2, c3],
    };
    const { clusters, stats } = buildClusters(input);
    const updates = clusters.filter((c) => c.kind === 'update') as UpdateCluster[];
    expect(updates).toHaveLength(1);
    expect(updates[0]!.targetPath).toBe(path);
    expect(updates[0]!.claims).toHaveLength(3);
    expect(stats.updateClusters).toBe(1);
  });

  test('1 claim with two update candidates → 2 UpdateClusters', () => {
    const path1 = 'Org/A/index.md';
    const path2 = 'Org/B/index.md';
    const c = makeClaim({ lines: [100, 101] });
    const input: ClusterInputs = {
      matches: [makeEntry(c, [{ path: path1, relation: 'update' }, { path: path2, relation: 'update' }])],
      aliasSuggestions: [],
      claims: [c],
    };
    const { clusters, stats } = buildClusters(input);
    const updates = clusters.filter((x) => x.kind === 'update') as UpdateCluster[];
    expect(updates).toHaveLength(2);
    expect(updates.map((u) => u.targetPath).sort()).toEqual([path1, path2].sort());
    expect(updates[0]!.claims[0]!.claim).toBe(c);
    expect(updates[1]!.claims[0]!.claim).toBe(c);
    expect(stats.updateClusters).toBe(2);
  });
});

describe('speculative routing', () => {
  test('speculative update → CommentCluster(reason: speculative), not UpdateCluster', () => {
    const path = 'Org/X/index.md';
    const c = makeClaim({ confidence: 'speculative' });
    const input: ClusterInputs = {
      matches: [makeEntry(c, [{ path, relation: 'update', rationale: 'player thinks so' }])],
      aliasSuggestions: [],
      claims: [c],
    };
    const { clusters, stats } = buildClusters(input);
    expect(clusters.filter((x) => x.kind === 'update')).toHaveLength(0);
    const comments = clusters.filter((x) => x.kind === 'comment') as CommentCluster[];
    expect(comments).toHaveLength(1);
    expect(comments[0]!.reason).toBe('speculative');
    expect(comments[0]!.relatedPath).toBe(path);
    expect(stats.commentClusters).toBe(1);
    expect(stats.updateClusters).toBe(0);
  });

  test('speculative standalone-new → CommentCluster(reason: speculative, relatedPath: null)', () => {
    const c = makeClaim({ confidence: 'speculative', entities: ['New Entity'] });
    const input: ClusterInputs = {
      matches: [makeEntry(c, [{ path: null, relation: 'new' }])],
      aliasSuggestions: [],
      claims: [c],
    };
    const { clusters, stats } = buildClusters(input);
    expect(clusters.filter((x) => x.kind === 'create')).toHaveLength(0);
    const comments = clusters.filter((x) => x.kind === 'comment') as CommentCluster[];
    expect(comments).toHaveLength(1);
    expect(comments[0]!.reason).toBe('speculative');
    expect(comments[0]!.relatedPath).toBeNull();
  });
});

describe('contradict routing', () => {
  test('contradict → CommentCluster(reason: contradict) regardless of confidence', () => {
    const path = 'Org/Y/index.md';
    for (const confidence of ['stated', 'inferred', 'speculative'] as const) {
      const c = makeClaim({ confidence });
      const input: ClusterInputs = {
        matches: [makeEntry(c, [{ path, relation: 'contradict', rationale: 'conflicts' }])],
        aliasSuggestions: [],
        claims: [c],
      };
      const { clusters } = buildClusters(input);
      const comments = clusters.filter((x) => x.kind === 'comment') as CommentCluster[];
      expect(comments).toHaveLength(1);
      expect(comments[0]!.reason).toBe('contradict');
      expect(comments[0]!.relatedPath).toBe(path);
    }
  });
});

describe('standalone-new clustering', () => {
  test('3 standalone-new claims, two share primaryEntity → 2 CreateClusters', () => {
    const entityA = 'Dura Oil Drinker';
    const entityB = 'Other Person';
    const ca1 = makeClaim({ claim: 'A fact 1', entities: [entityA], entityResolutions: [{ original: entityA, canonical: entityA, page: null, method: 'none', suggestAlias: false }] });
    const ca2 = makeClaim({ claim: 'A fact 2', lines: [200, 200], entities: [entityA], entityResolutions: [{ original: entityA, canonical: entityA, page: null, method: 'none', suggestAlias: false }] });
    const cb = makeClaim({ claim: 'B fact', lines: [300, 300], entities: [entityB], entityResolutions: [{ original: entityB, canonical: entityB, page: null, method: 'none', suggestAlias: false }] });
    const input: ClusterInputs = {
      matches: [
        makeEntry(ca1, [{ path: null, relation: 'new' }]),
        makeEntry(ca2, [{ path: null, relation: 'new' }]),
        makeEntry(cb, [{ path: null, relation: 'new' }]),
      ],
      aliasSuggestions: [],
      claims: [ca1, ca2, cb],
    };
    const { clusters, stats } = buildClusters(input);
    const creates = clusters.filter((x) => x.kind === 'create') as CreateCluster[];
    expect(creates).toHaveLength(2);
    const aCluster = creates.find((c) => c.primaryEntity === entityA);
    expect(aCluster).toBeDefined();
    expect(aCluster!.claims).toHaveLength(2);
    expect(stats.createClusters).toBe(2);
  });
});

describe('skipped entries', () => {
  test('consistent → skipped, counted in skippedConsistent', () => {
    const c = makeClaim();
    const input: ClusterInputs = {
      matches: [makeEntry(c, [{ path: 'Org/Z/index.md', relation: 'consistent' }])],
      aliasSuggestions: [],
      claims: [c],
    };
    const { clusters, stats } = buildClusters(input);
    expect(clusters).toHaveLength(0);
    expect(stats.skippedConsistent).toBe(1);
  });

  test('classifier-new-with-path → skipped, counted in skippedClassifierNew', () => {
    const c = makeClaim();
    const input: ClusterInputs = {
      matches: [makeEntry(c, [{ path: 'Org/W/index.md', relation: 'new' }])],
      aliasSuggestions: [],
      claims: [c],
    };
    const { clusters, stats } = buildClusters(input);
    expect(clusters).toHaveLength(0);
    expect(stats.skippedClassifierNew).toBe(1);
  });
});

describe('alias edit clusters', () => {
  test('alias suggestion with citing claim → AliasEditCluster', () => {
    const claim = makeClaim({
      entities: ['Aelindra'],
      entityResolutions: [{
        original: 'Aelindra',
        canonical: 'Aelindra the Bright',
        page: 'Org/Council/People/Aelindra the Bright.md',
        method: 'llm',
        suggestAlias: true,
      }],
    });
    const suggestion: AliasSuggestion = {
      variant: 'Aelindra',
      canonical: 'Aelindra the Bright',
      page: 'Org/Council/People/Aelindra the Bright.md',
      method: 'llm',
      occurrences: 1,
    };
    const input: ClusterInputs = {
      matches: [],
      aliasSuggestions: [suggestion],
      claims: [claim],
    };
    const { clusters, stats } = buildClusters(input);
    const aliasEdits = clusters.filter((x) => x.kind === 'alias-edit') as AliasEditCluster[];
    expect(aliasEdits).toHaveLength(1);
    expect(aliasEdits[0]!.targetPath).toBe('Org/Council/People/Aelindra the Bright.md');
    expect(aliasEdits[0]!.variantsToAdd).toEqual(['Aelindra']);
    expect(aliasEdits[0]!.citations).toEqual([[100, 101]]);
    expect(stats.aliasEditClusters).toBe(1);
  });

  test('multiple variants for same page → one cluster with deduped variants', () => {
    const claim1 = makeClaim({
      lines: [100, 100],
      entities: ['Aelindra'],
      entityResolutions: [{ original: 'Aelindra', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', suggestAlias: true }],
    });
    const claim2 = makeClaim({
      lines: [200, 200],
      entities: ['Ael'],
      entityResolutions: [{ original: 'Ael', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', suggestAlias: true }],
    });
    const suggestions: AliasSuggestion[] = [
      { variant: 'Aelindra', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', occurrences: 1 },
      { variant: 'Ael', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', occurrences: 1 },
    ];
    const input: ClusterInputs = {
      matches: [],
      aliasSuggestions: suggestions,
      claims: [claim1, claim2],
    };
    const { clusters } = buildClusters(input);
    const aliasEdits = clusters.filter((x) => x.kind === 'alias-edit') as AliasEditCluster[];
    expect(aliasEdits).toHaveLength(1);
    expect(aliasEdits[0]!.variantsToAdd).toEqual(['Aelindra', 'Ael']);
    expect(aliasEdits[0]!.citations).toHaveLength(2);
  });

  test('duplicate variant (case-insensitive) → deduped to one', () => {
    const claim = makeClaim({
      entityResolutions: [{ original: 'aelindra', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', suggestAlias: true }],
    });
    const suggestions: AliasSuggestion[] = [
      { variant: 'Aelindra', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', occurrences: 2 },
      { variant: 'aelindra', canonical: 'Full Name', page: 'Org/P.md', method: 'llm', occurrences: 1 },
    ];
    const input: ClusterInputs = {
      matches: [],
      aliasSuggestions: suggestions,
      claims: [claim],
    };
    const { clusters } = buildClusters(input);
    const aliasEdits = clusters.filter((x) => x.kind === 'alias-edit') as AliasEditCluster[];
    expect(aliasEdits).toHaveLength(1);
    expect(aliasEdits[0]!.variantsToAdd).toHaveLength(1);
  });

  test('no claim cites variant → cluster dropped with warning', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const suggestion: AliasSuggestion = {
        variant: 'Orphan',
        canonical: 'Real Name',
        page: 'Org/R.md',
        method: 'fuzzy',
        occurrences: 1,
      };
      const input: ClusterInputs = {
        matches: [],
        aliasSuggestions: [suggestion],
        claims: [],
      };
      const { clusters } = buildClusters(input);
      expect(clusters.filter((x) => x.kind === 'alias-edit')).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('primary entity selection', () => {
  test('tie-breaking: two entities with same count → alphabetical wins', () => {
    // Both "Beta" and "Alpha" appear once in unresolved entities.
    // "Alpha" should win alphabetically.
    const alpha = 'Alpha Entity';
    const beta = 'Beta Entity';
    const c = makeClaim({
      entities: [beta, alpha],
      entityResolutions: [
        { original: beta, canonical: beta, page: null, method: 'none', suggestAlias: false },
        { original: alpha, canonical: alpha, page: null, method: 'none', suggestAlias: false },
      ],
    });
    const input: ClusterInputs = {
      matches: [makeEntry(c, [{ path: null, relation: 'new' }])],
      aliasSuggestions: [],
      claims: [c],
    };
    const { clusters } = buildClusters(input);
    const creates = clusters.filter((x) => x.kind === 'create') as CreateCluster[];
    expect(creates).toHaveLength(1);
    expect(creates[0]!.primaryEntity).toBe(alpha);
  });

  test('entity with higher occurrence count wins tie-break', () => {
    const rare = 'Rare Entity';
    const common = 'Common Entity';
    // common appears in multiple claims
    const c1 = makeClaim({
      entities: [common],
      entityResolutions: [{ original: common, canonical: common, page: null, method: 'none', suggestAlias: false }],
    });
    const c2 = makeClaim({
      lines: [200, 200],
      entities: [common],
      entityResolutions: [{ original: common, canonical: common, page: null, method: 'none', suggestAlias: false }],
    });
    const c3 = makeClaim({
      lines: [300, 300],
      entities: [rare, common],
      entityResolutions: [
        { original: rare, canonical: rare, page: null, method: 'none', suggestAlias: false },
        { original: common, canonical: common, page: null, method: 'none', suggestAlias: false },
      ],
    });
    const input: ClusterInputs = {
      matches: [
        makeEntry(c1, [{ path: null, relation: 'new' }]),
        makeEntry(c2, [{ path: null, relation: 'new' }]),
        makeEntry(c3, [{ path: null, relation: 'new' }]),
      ],
      aliasSuggestions: [],
      claims: [c1, c2, c3],
    };
    const { clusters } = buildClusters(input);
    const creates = clusters.filter((x) => x.kind === 'create') as CreateCluster[];
    // c3 should get common entity as primary (3 occurrences vs 1 for rare)
    const c3Cluster = creates.find((x) => x.claims.some((cl) => cl.claim === c3));
    expect(c3Cluster?.primaryEntity).toBe(common);
  });

  test('empty entities → claim skipped with warning', () => {
    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;
    try {
      const c = makeClaim({ entities: [], entityResolutions: [] });
      const input: ClusterInputs = {
        matches: [makeEntry(c, [{ path: null, relation: 'new' }])],
        aliasSuggestions: [],
        claims: [c],
      };
      const { clusters } = buildClusters(input);
      expect(clusters.filter((x) => x.kind === 'create')).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('determinism', () => {
  test('cluster order is stable across two identical runs', () => {
    const c1 = makeClaim({ claim: 'C1', lines: [100, 100], entities: ['E1'], entityResolutions: [{ original: 'E1', canonical: 'E1', page: null, method: 'none', suggestAlias: false }] });
    const c2 = makeClaim({ claim: 'C2', lines: [200, 200], entities: ['E2'], entityResolutions: [{ original: 'E2', canonical: 'E2', page: null, method: 'none', suggestAlias: false }] });
    const input: ClusterInputs = {
      matches: [
        makeEntry(c1, [{ path: null, relation: 'new' }]),
        makeEntry(c2, [{ path: 'Org/B.md', relation: 'update' }]),
      ],
      aliasSuggestions: [],
      claims: [c1, c2],
    };
    const r1 = buildClusters(input);
    const r2 = buildClusters(input);
    expect(r1.clusters.map((c) => c.kind)).toEqual(r2.clusters.map((c) => c.kind));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
