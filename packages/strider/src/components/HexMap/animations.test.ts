import { describe, expect, it } from "vitest";
import { computeRegionBorders, type EdgeSegment } from "@/lib/hexUtils";
import {
  axialDistance,
  easeOutCubic,
  edgeLength,
  orderEdgesIntoPath,
  partialEdgePath,
  totalEdgeLength,
} from "./animations";

describe("orderEdgesIntoPath", () => {
  it("returns an empty list for no edges", () => {
    expect(orderEdgesIntoPath([])).toEqual([]);
  });

  it("walks a single hex's six edges into one closed loop", () => {
    const edges = computeRegionBorders([[0, 0]]);
    expect(edges.length).toBe(6);
    const ordered = orderEdgesIntoPath(edges);
    expect(ordered.length).toBe(6);
    // Each edge's tail should match the next edge's head (closed loop).
    for (let i = 0; i < ordered.length - 1; i++) {
      const tail: readonly [number, number] = [ordered[i][2], ordered[i][3]];
      const nextHead: readonly [number, number] = [
        ordered[i + 1][0],
        ordered[i + 1][1],
      ];
      expect(tail[0]).toBeCloseTo(nextHead[0]);
      expect(tail[1]).toBeCloseTo(nextHead[1]);
    }
  });

  it("preserves every edge from a multi-hex region", () => {
    const edges = computeRegionBorders([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    const ordered = orderEdgesIntoPath(edges);
    expect(ordered.length).toBe(edges.length);
  });
});

describe("partialEdgePath", () => {
  const square: EdgeSegment[] = [
    [0, 0, 10, 0],
    [10, 0, 10, 10],
    [10, 10, 0, 10],
    [0, 10, 0, 0],
  ];
  const totalLen = totalEdgeLength(square);

  it("returns empty/null at t=0", () => {
    const { full, tail } = partialEdgePath(square, totalLen, 0);
    expect(full).toEqual([]);
    expect(tail).toBeNull();
  });

  it("returns all edges and no tail at t=1", () => {
    const { full, tail } = partialEdgePath(square, totalLen, 1);
    expect(full.length).toBe(4);
    expect(tail).toBeNull();
  });

  it("halfway returns 2 full edges and no tail (exact boundary)", () => {
    const { full, tail } = partialEdgePath(square, totalLen, 0.5);
    expect(full.length).toBe(2);
    // Exact halfway sits on an edge boundary; tail is either null or
    // a zero-length stub on the next edge.
    if (tail !== null) {
      expect(edgeLength(tail)).toBeLessThanOrEqual(0.001);
    }
  });

  it("at t=0.625 returns 2 full edges plus a half-length tail", () => {
    const { full, tail } = partialEdgePath(square, totalLen, 0.625);
    expect(full.length).toBe(2);
    expect(tail).not.toBeNull();
    if (tail) {
      expect(edgeLength(tail)).toBeCloseTo(5, 5);
    }
  });
});

describe("axialDistance", () => {
  it("is zero for the same hex", () => {
    expect(axialDistance([2, -3], [2, -3])).toBe(0);
  });

  it("matches one-step neighbors", () => {
    expect(axialDistance([0, 0], [1, 0])).toBe(1);
    expect(axialDistance([0, 0], [0, 1])).toBe(1);
    expect(axialDistance([0, 0], [-1, 1])).toBe(1);
  });

  it("computes a known multi-step distance", () => {
    // (0,0) → (2,-1): dq=2, dr=-1, dq+dr=1 → (2 + 1 + 1) / 2 = 2
    expect(axialDistance([0, 0], [2, -1])).toBe(2);
    // (0,0) → (3,3): dq=3, dr=3, dq+dr=6 → (3 + 6 + 3) / 2 = 6
    expect(axialDistance([0, 0], [3, 3])).toBe(6);
  });
});

describe("easeOutCubic", () => {
  it("hits the endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("is monotonically increasing", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const v = easeOutCubic(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
