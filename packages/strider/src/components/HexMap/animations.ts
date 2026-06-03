import type { EdgeSegment } from "@/lib/hexUtils";

// Greedy adjacency walk that re-orders a region's perimeter edges into a
// connected sequence of runs. Regions can have holes, so the output may be
// multiple chained runs concatenated; the draw-on animation walks the whole
// list linearly, drawing each edge end-to-end.
//
// Within a run, each edge is oriented so its second endpoint matches the next
// edge's first endpoint. Cross-run boundaries are unavoidable visual jumps.
export function orderEdgesIntoPath(
  edges: ReadonlyArray<EdgeSegment>,
): EdgeSegment[] {
  if (edges.length === 0) return [];

  const pointKey = (x: number, y: number): string =>
    `${x.toFixed(6)},${y.toFixed(6)}`;
  const remaining = new Map<number, EdgeSegment>();
  edges.forEach((e, i) => remaining.set(i, e));

  // index endpoints → set of edge indices touching them
  const touching = new Map<string, Set<number>>();
  for (const [i, e] of remaining) {
    for (const k of [pointKey(e[0], e[1]), pointKey(e[2], e[3])]) {
      let set = touching.get(k);
      if (!set) {
        set = new Set();
        touching.set(k, set);
      }
      set.add(i);
    }
  }

  function consume(idx: number): EdgeSegment {
    const seg = remaining.get(idx)!;
    remaining.delete(idx);
    for (const k of [pointKey(seg[0], seg[1]), pointKey(seg[2], seg[3])]) {
      touching.get(k)?.delete(idx);
    }
    return seg;
  }

  const out: EdgeSegment[] = [];
  while (remaining.size > 0) {
    // Start a new run with whichever edge index is still around.
    const startIdx = remaining.keys().next().value as number;
    const startSeg = consume(startIdx);
    out.push(startSeg);
    let tailX = startSeg[2];
    let tailY = startSeg[3];

    // Extend the run as far as endpoints chain.
    while (true) {
      const candidates = touching.get(pointKey(tailX, tailY));
      if (!candidates || candidates.size === 0) break;
      const nextIdx = candidates.values().next().value as number;
      const seg = consume(nextIdx);
      // Orient so first endpoint matches tail.
      const tailKey = pointKey(tailX, tailY);
      let oriented: EdgeSegment;
      if (pointKey(seg[0], seg[1]) === tailKey) {
        oriented = seg;
      } else {
        oriented = [seg[2], seg[3], seg[0], seg[1]];
      }
      out.push(oriented);
      tailX = oriented[2];
      tailY = oriented[3];
    }
  }

  return out;
}

export function edgeLength(e: EdgeSegment): number {
  return Math.hypot(e[2] - e[0], e[3] - e[1]);
}

export function totalEdgeLength(edges: ReadonlyArray<EdgeSegment>): number {
  let sum = 0;
  for (const e of edges) sum += edgeLength(e);
  return sum;
}

// Returns the slice of edges to draw at normalized progress t. `full` is the
// complete edges already passed; `tail` is a partial segment ending at the
// current cursor along the next edge (null if exactly at a boundary or done).
export function partialEdgePath(
  ordered: ReadonlyArray<EdgeSegment>,
  totalLen: number,
  t: number,
): { full: EdgeSegment[]; tail: EdgeSegment | null } {
  if (ordered.length === 0 || totalLen === 0) {
    return { full: [], tail: null };
  }
  if (t <= 0) return { full: [], tail: null };
  if (t >= 1) return { full: ordered.slice(), tail: null };

  const target = totalLen * t;
  const full: EdgeSegment[] = [];
  let walked = 0;
  for (const e of ordered) {
    const len = edgeLength(e);
    if (walked + len <= target) {
      full.push(e);
      walked += len;
      continue;
    }
    const remaining = target - walked;
    const frac = remaining / len;
    const x = e[0] + (e[2] - e[0]) * frac;
    const y = e[1] + (e[3] - e[1]) * frac;
    return { full, tail: [e[0], e[1], x, y] };
  }
  return { full, tail: null };
}

// Axial hex distance. Standard formula for pointy/flat-top axial coords:
// (|dq| + |dq+dr| + |dr|) / 2.
export function axialDistance(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dq = a[0] - b[0];
  const dr = a[1] - b[1];
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}
