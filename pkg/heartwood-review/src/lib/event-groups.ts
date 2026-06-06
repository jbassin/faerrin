// AC-22: group proposals that stem from one real-world event so related per-page edits are
// reviewed together. The pipeline groups facts per-entity (one proposal per entity), not per
// event, so we infer event grouping from CITATION OVERLAP: proposals whose facts cite the same
// or nearby transcript lines almost certainly describe the same moment (e.g. "a place falls
// under a faction's control" cites the same lines on both the place and the faction page).
// Pure + testable; no pipeline change.

interface Span {
  transcript: string;
  start: number;
  end: number;
}

interface ProposalLike {
  id: string;
  facts: { citations: { transcript: string; start: number; end: number }[] }[];
}

function spansOf(p: ProposalLike): Span[] {
  return p.facts.flatMap((f) => f.citations);
}

/** Two spans link if they're on the same transcript and overlap or sit within `gap` lines. */
function linked(a: Span[], b: Span[], gap: number): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.transcript !== y.transcript) continue;
      if (x.start - gap <= y.end && y.start - gap <= x.end) return true;
    }
  }
  return false;
}

/**
 * Partition proposals into event groups (connected components by citation proximity).
 * Returns groups in input order; singletons included. `gap` is the line-proximity window.
 */
export function groupProposalsByEvent(proposals: ProposalLike[], gap = 15): string[][] {
  const n = proposals.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };

  const spans = proposals.map(spansOf);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (linked(spans[i]!, spans[j]!, gap)) union(i, j);
    }
  }

  // Collect components, preserving first-appearance order.
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(proposals[i]!.id);
  }
  return [...groups.values()];
}
