import { describe, expect, it } from "vitest";
import {
  FACTION_HEXES,
  UNOWNED_BASE_HEXES,
  FACTION_BORDERS,
  FACTION_TERRITORY_BORDERS,
  GRID_RADIUS,
  computeEffectiveAssignments,
  hexesInRadius,
} from "./hexUtils";

const HARLEQUINS_INDEX = 19;

describe("hexesInRadius", () => {
  it("returns 1 hex for R=0", () => {
    expect(hexesInRadius(0)).toHaveLength(1);
  });

  it("returns 91 hexes for R=5", () => {
    expect(hexesInRadius(5)).toHaveLength(91);
  });

  it("returns 3781 hexes for R=35", () => {
    expect(hexesInRadius(35)).toHaveLength(3781);
  });

  it("returns 3*R*(R+1)+1 hexes for R=1 through R=5", () => {
    for (const R of [1, 2, 3, 4, 5]) {
      expect(hexesInRadius(R)).toHaveLength(3 * R * (R + 1) + 1);
    }
  });
});

describe("FACTION_HEXES", () => {
  it("contains exactly 20 faction groups", () => {
    expect(FACTION_HEXES).toHaveLength(20);
  });

  it("only the Harlequins have a non-empty base territory", () => {
    for (let i = 0; i < FACTION_HEXES.length; i++) {
      if (i === HARLEQUINS_INDEX) {
        expect(FACTION_HEXES[i].length).toBeGreaterThan(0);
      } else {
        expect(FACTION_HEXES[i]).toEqual([]);
      }
    }
  });

  it("no hex coordinate appears in more than one faction", () => {
    const seen = new Set<string>();
    for (const hexes of FACTION_HEXES) {
      for (const [q, r] of hexes) {
        const key = `${q},${r}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("assigns the origin hex to the Harlequins (they claim the central unclaimed region)", () => {
    const harlequinKeys = new Set(
      FACTION_HEXES[HARLEQUINS_INDEX].map(([q, r]) => `${q},${r}`),
    );
    expect(harlequinKeys.has("0,0")).toBe(true);
  });
});

describe("UNOWNED_BASE_HEXES", () => {
  it("is non-empty and contains the bulk of the grid", () => {
    expect(UNOWNED_BASE_HEXES.length).toBeGreaterThan(40);
    // 19 ring factions × ≤190 hexes each is a loose upper bound on what the
    // Voronoi assignment can produce.
    expect(UNOWNED_BASE_HEXES.length).toBeLessThan(190 * 19);
  });

  it("never overlaps the Harlequins' base territory", () => {
    const harlequinKeys = new Set(
      FACTION_HEXES[HARLEQUINS_INDEX].map(([q, r]) => `${q},${r}`),
    );
    for (const [q, r] of UNOWNED_BASE_HEXES) {
      expect(harlequinKeys.has(`${q},${r}`)).toBe(false);
    }
  });

  it("has no duplicate coordinates", () => {
    const seen = new Set<string>();
    for (const [q, r] of UNOWNED_BASE_HEXES) {
      const key = `${q},${r}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("covers all four quadrants of the grid", () => {
    let posQ = false;
    let negQ = false;
    let posR = false;
    let negR = false;
    for (const [q, r] of UNOWNED_BASE_HEXES) {
      if (q > 0) posQ = true;
      if (q < 0) negQ = true;
      if (r > 0) posR = true;
      if (r < 0) negR = true;
    }
    expect(posQ && negQ && posR && negR).toBe(true);
  });
});

describe("FACTION_BORDERS", () => {
  it("is non-empty and all coordinates are finite", () => {
    expect(FACTION_BORDERS.length).toBeGreaterThan(0);
    for (const [x1, y1, x2, y2] of FACTION_BORDERS) {
      expect(isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)).toBe(
        true,
      );
    }
  });

  it("has no duplicate edges", () => {
    const keys = FACTION_BORDERS.map(
      ([x1, y1, x2, y2]) => `${x1},${y1},${x2},${y2}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("FACTION_TERRITORY_BORDERS has 20 entries, only the Harlequins' is non-empty", () => {
    expect(FACTION_TERRITORY_BORDERS.length).toBe(20);
    for (let i = 0; i < FACTION_TERRITORY_BORDERS.length; i++) {
      if (i === HARLEQUINS_INDEX) {
        expect(FACTION_TERRITORY_BORDERS[i].length).toBeGreaterThan(0);
      } else {
        expect(FACTION_TERRITORY_BORDERS[i]).toEqual([]);
      }
    }
  });
});

describe("computeEffectiveAssignments", () => {
  const base = [
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [3, 0],
      [4, 0],
    ],
  ] as const;
  const slugs = ["alpha", "beta"];

  it("returns the base assignment when there are no overrides", () => {
    const overrides = new Map<string, string | null>();
    const result = computeEffectiveAssignments(base, [], overrides, slugs);
    expect(result.perFaction[0]).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(result.perFaction[1]).toEqual([
      [3, 0],
      [4, 0],
    ]);
    expect(result.unowned).toEqual([]);
  });

  it("moves an overridden hex from its base faction to the target faction", () => {
    const overrides = new Map<string, string | null>([["1,0", "beta"]]);
    const result = computeEffectiveAssignments(base, [], overrides, slugs);
    expect(result.perFaction[0]).toEqual([
      [0, 0],
      [2, 0],
    ]);
    expect(result.perFaction[1]).toEqual([
      [1, 0],
      [3, 0],
      [4, 0],
    ]);
    expect(result.unowned).toEqual([]);
  });

  it("places explicitly-null overrides into the unowned bucket", () => {
    const overrides = new Map<string, string | null>([["3,0", null]]);
    const result = computeEffectiveAssignments(base, [], overrides, slugs);
    expect(result.perFaction[1]).toEqual([[4, 0]]);
    expect(result.unowned).toEqual([[3, 0]]);
  });

  it("throws when a claim references an unknown faction slug", () => {
    const overrides = new Map<string, string | null>([["0,0", "ghost"]]);
    expect(() =>
      computeEffectiveAssignments(base, [], overrides, slugs),
    ).toThrow(/unknown faction 'ghost'/);
  });

  it("treats baseUnowned hexes with no override as unowned", () => {
    const baseUnowned = [
      [10, 0],
      [11, 0],
    ] as const;
    const overrides = new Map<string, string | null>();
    const result = computeEffectiveAssignments(
      base,
      baseUnowned,
      overrides,
      slugs,
    );
    expect(result.unowned).toEqual([
      [10, 0],
      [11, 0],
    ]);
  });

  it("moves a baseUnowned hex into a faction when a claim names that faction", () => {
    const baseUnowned = [
      [10, 0],
      [11, 0],
    ] as const;
    const overrides = new Map<string, string | null>([["10,0", "alpha"]]);
    const result = computeEffectiveAssignments(
      base,
      baseUnowned,
      overrides,
      slugs,
    );
    expect(result.perFaction[0]).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [10, 0],
    ]);
    expect(result.unowned).toEqual([[11, 0]]);
  });

  it("keeps a baseUnowned hex unowned when a claim explicitly nulls it", () => {
    const baseUnowned = [[10, 0]] as const;
    const overrides = new Map<string, string | null>([["10,0", null]]);
    const result = computeEffectiveAssignments(
      base,
      baseUnowned,
      overrides,
      slugs,
    );
    expect(result.unowned).toEqual([[10, 0]]);
  });
});

describe("FACTION_HEXES + UNOWNED_BASE_HEXES coverage", () => {
  it("together they cover the full R=35 grid exactly once", () => {
    const allGrid = new Set(
      hexesInRadius(GRID_RADIUS).map(([q, r]) => `${q},${r}`),
    );
    const assigned = new Set<string>();
    for (const hexes of FACTION_HEXES) {
      for (const [q, r] of hexes) {
        const key = `${q},${r}`;
        expect(assigned.has(key)).toBe(false);
        assigned.add(key);
      }
    }
    for (const [q, r] of UNOWNED_BASE_HEXES) {
      const key = `${q},${r}`;
      expect(assigned.has(key)).toBe(false);
      assigned.add(key);
    }
    expect(assigned.size).toBe(allGrid.size);
    for (const key of allGrid) {
      expect(assigned.has(key)).toBe(true);
    }
  });
});
