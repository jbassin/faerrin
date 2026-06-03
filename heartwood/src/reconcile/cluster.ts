import type { Claim } from '../transcript/extract';
import type { MatchEntry } from './match';
import type { AliasSuggestion } from './resolve';

export type Citation = [number, number];

export interface UpdateCluster {
  kind: 'update';
  targetPath: string;
  claims: { claim: Claim; rationale: string; excerpt: string | null }[];
}

export interface CreateCluster {
  kind: 'create';
  primaryEntity: string;
  claims: { claim: Claim; rationale: string }[];
}

export interface AliasEditCluster {
  kind: 'alias-edit';
  targetPath: string;
  variantsToAdd: string[];
  citations: Citation[];
}

export interface CommentCluster {
  kind: 'comment';
  reason: 'contradict' | 'speculative';
  relatedPath: string | null;
  claim: Claim;
  rationale: string;
  excerpt: string | null;
}

export type Cluster =
  | UpdateCluster
  | CreateCluster
  | AliasEditCluster
  | CommentCluster;

export interface ClusterInputs {
  matches: MatchEntry[];
  aliasSuggestions: AliasSuggestion[];
  claims: Claim[];
}

export interface ClusterStats {
  updateClusters:      number;
  createClusters:      number;
  aliasEditClusters:   number;
  commentClusters:     number;
  skippedConsistent:   number;
  skippedClassifierNew: number;
}

export interface ClusterResult {
  clusters: Cluster[];
  stats:    ClusterStats;
}

export function buildClusters(input: ClusterInputs): ClusterResult {
  const updateMap = new Map<string, UpdateCluster>();
  const createMap = new Map<string, CreateCluster>();
  const comments: CommentCluster[] = [];

  let skippedConsistent = 0;
  let skippedClassifierNew = 0;

  // Precompute entity occurrence counts for standalone-new primary entity selection.
  // Count entities that have no wiki page (page === null) across all claims.
  const entityOccurrences = new Map<string, number>();
  for (const claim of input.claims) {
    const resolutions = claim.entityResolutions ?? [];
    for (const res of resolutions) {
      if (res.page === null) {
        entityOccurrences.set(res.original, (entityOccurrences.get(res.original) ?? 0) + 1);
      }
    }
  }

  for (const entry of input.matches) {
    const { claim, candidatePages } = entry;

    // Standalone-new: exactly one candidate with path === null.
    if (candidatePages.length === 1 && candidatePages[0]!.path === null) {
      if (claim.confidence === 'speculative') {
        comments.push({
          kind: 'comment',
          reason: 'speculative',
          relatedPath: null,
          claim,
          rationale: candidatePages[0]!.rationale,
          excerpt: candidatePages[0]!.excerpt,
        });
      } else {
        const primaryEntity = pickPrimaryEntity(claim, entityOccurrences);
        if (primaryEntity === null) {
          console.warn(`cluster: claim has no resolvable primary entity, skipping: "${claim.claim.slice(0, 60)}"`);
          continue;
        }
        const existing = createMap.get(primaryEntity);
        if (existing) {
          existing.claims.push({ claim, rationale: candidatePages[0]!.rationale });
        } else {
          createMap.set(primaryEntity, {
            kind: 'create',
            primaryEntity,
            claims: [{ claim, rationale: candidatePages[0]!.rationale }],
          });
        }
      }
      continue;
    }

    // Multi-candidate path.
    for (let ci = 0; ci < candidatePages.length; ci++) {
      const cand = candidatePages[ci]!;

      if (cand.relation === 'consistent') {
        skippedConsistent++;
        continue;
      }

      if (cand.relation === 'new' && cand.path !== null) {
        skippedClassifierNew++;
        continue;
      }

      if (cand.relation === 'contradict') {
        comments.push({
          kind: 'comment',
          reason: 'contradict',
          relatedPath: cand.path,
          claim,
          rationale: cand.rationale,
          excerpt: cand.excerpt,
        });
        continue;
      }

      if (cand.relation === 'update' && cand.path !== null) {
        if (claim.confidence === 'speculative') {
          comments.push({
            kind: 'comment',
            reason: 'speculative',
            relatedPath: cand.path,
            claim,
            rationale: cand.rationale,
            excerpt: cand.excerpt,
          });
        } else {
          const existing = updateMap.get(cand.path);
          if (existing) {
            existing.claims.push({ claim, rationale: cand.rationale, excerpt: cand.excerpt });
          } else {
            updateMap.set(cand.path, {
              kind: 'update',
              targetPath: cand.path,
              claims: [{ claim, rationale: cand.rationale, excerpt: cand.excerpt }],
            });
          }
        }
        continue;
      }
    }
  }

  // Alias-edit clusters: group by page, deduplicate variants (case-insensitive).
  const aliasEditMap = new Map<string, AliasEditCluster>();
  for (const suggestion of input.aliasSuggestions) {
    if (!suggestion.page) continue;

    // Find claims citing this alias suggestion via entityResolutions.
    const citationClaims = input.claims.filter((c) =>
      (c.entityResolutions ?? []).some(
        (r) => r.suggestAlias && r.page === suggestion.page && r.original === suggestion.variant,
      ),
    );
    if (citationClaims.length === 0) {
      console.warn(
        `cluster: no claims cite alias suggestion "${suggestion.variant}" → ${suggestion.page} — dropping`,
      );
      continue;
    }

    const existing = aliasEditMap.get(suggestion.page);
    if (existing) {
      // Deduplicate case-insensitively.
      const lowerExisting = existing.variantsToAdd.map((v) => v.toLowerCase());
      if (!lowerExisting.includes(suggestion.variant.toLowerCase())) {
        existing.variantsToAdd.push(suggestion.variant);
      }
      for (const c of citationClaims) {
        existing.citations.push(c.lines);
      }
    } else {
      aliasEditMap.set(suggestion.page, {
        kind: 'alias-edit',
        targetPath: suggestion.page,
        variantsToAdd: [suggestion.variant],
        citations: citationClaims.map((c) => c.lines),
      });
    }
  }

  // Sort comments by (claim.lines[0], claim.lines[1], candidateIndex).
  // Since we don't track candidateIndex explicitly, sort by (lines[0], lines[1], relatedPath).
  comments.sort((a, b) => {
    const la = a.claim.lines[0] - b.claim.lines[0];
    if (la !== 0) return la;
    const lb = a.claim.lines[1] - b.claim.lines[1];
    if (lb !== 0) return lb;
    return (a.relatedPath ?? '').localeCompare(b.relatedPath ?? '');
  });

  // Sort update/create/alias-edit clusters alphabetically for determinism.
  const updateClusters = [...updateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
  const createClusters = [...createMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
  const aliasEditClusters = [...aliasEditMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  const clusters: Cluster[] = [
    ...updateClusters,
    ...createClusters,
    ...aliasEditClusters,
    ...comments,
  ];

  return {
    clusters,
    stats: {
      updateClusters:      updateClusters.length,
      createClusters:      createClusters.length,
      aliasEditClusters:   aliasEditClusters.length,
      commentClusters:     comments.length,
      skippedConsistent,
      skippedClassifierNew,
    },
  };
}

function pickPrimaryEntity(
  claim: Claim,
  entityOccurrences: Map<string, number>,
): string | null {
  if (claim.entities.length === 0) return null;

  const resolutions = claim.entityResolutions ?? [];

  // Filter to entities that found no wiki page.
  const unresolved = claim.entities.filter((e) =>
    resolutions.some((r) => r.original === e && r.page === null),
  );

  const candidates = unresolved.length > 0 ? unresolved : [claim.entities[0]!];

  if (candidates.length === 1) return candidates[0]!;

  // Tie-break: highest occurrence count, then alphabetical.
  candidates.sort((a, b) => {
    const diff = (entityOccurrences.get(b) ?? 0) - (entityOccurrences.get(a) ?? 0);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  return candidates[0]!;
}
