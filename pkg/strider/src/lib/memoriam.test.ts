import { describe, it, expect } from "vitest";
import type { Faction } from "@/lib/factions";
import type { Layer } from "@/lib/regions";
import { FACTION_HEXES } from "@/lib/hexUtils";
import { computeFallenStateByCursor, fallenAtCursor } from "./memoriam";

function fakeFactions(): Faction[] {
  return Array.from({ length: 20 }, (_, i) => ({
    name: `Faction ${i}`,
    slug: `f${i}`,
    color: "#000",
    order: i + 1,
    symbol: null,
    description: "",
    members: [],
  }));
}

function layer(
  slug: string,
  timestamp: string,
  changes: Layer["changes"],
): Layer {
  return { slug, timestamp, message: "", changes, body: "" };
}

describe("computeFallenStateByCursor", () => {
  it("returns a single all-null row when there are no layers", () => {
    const state = computeFallenStateByCursor(fakeFactions(), []);
    expect(state).toHaveLength(1);
    expect(state[0].every((v) => v === null)).toBe(true);
  });

  it("does not mark a never-present ring faction as fallen", () => {
    const factions = fakeFactions();
    const state = computeFallenStateByCursor(factions, [
      layer("noop", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
    ]);
    expect(state[1][0]).toBeNull();
  });

  it("records the fall layer when a faction loses its last hex", () => {
    const factions = fakeFactions();
    const state = computeFallenStateByCursor(factions, [
      layer("arrive", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-100, -100]] },
      ]),
      layer("fall", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
    ]);
    expect(state[0][0]).toBeNull();
    expect(state[1][0]).toBeNull();
    expect(state[2][0]).toBe(2);
  });

  it("clears the fall record when a fallen faction recovers", () => {
    const factions = fakeFactions();
    const state = computeFallenStateByCursor(factions, [
      layer("arrive", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-100, -100]] },
      ]),
      layer("fall", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
      layer("rebirth", "2026-01-03T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-99, -99]] },
      ]),
    ]);
    expect(state[2][0]).toBe(2);
    expect(state[3][0]).toBeNull();
  });

  it("records the most recent fall after a recovery", () => {
    const factions = fakeFactions();
    const state = computeFallenStateByCursor(factions, [
      layer("arrive", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-100, -100]] },
      ]),
      layer("first-fall", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
      layer("rebirth", "2026-01-03T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-99, -99]] },
      ]),
      layer("second-fall", "2026-01-04T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-99, -99]] },
      ]),
    ]);
    expect(state[4][0]).toBe(4);
  });

  it("marks the Harlequins as fallen if their base territory is wiped", () => {
    const factions = fakeFactions();
    const harlequinIdx = 19;
    const allHarlequinHexes = FACTION_HEXES[harlequinIdx].map(
      ([q, r]) => [q, r] as [number, number],
    );
    const state = computeFallenStateByCursor(factions, [
      layer("genocide", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: null, hexes: allHarlequinHexes },
      ]),
    ]);
    expect(state[0][harlequinIdx]).toBeNull();
    expect(state[1][harlequinIdx]).toBe(1);
  });
});

describe("fallenAtCursor", () => {
  it("returns an empty list when nothing has fallen", () => {
    const factions = fakeFactions();
    const layers: Layer[] = [];
    const state = computeFallenStateByCursor(factions, layers);
    expect(fallenAtCursor(factions, layers, state, 0)).toEqual([]);
  });

  it("produces entries with the fall layer's timestamp", () => {
    const factions = fakeFactions();
    const layers = [
      layer("arrive", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-100, -100]] },
      ]),
      layer("fall", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
    ];
    const state = computeFallenStateByCursor(factions, layers);
    expect(fallenAtCursor(factions, layers, state, 1)).toEqual([]);
    const result = fallenAtCursor(factions, layers, state, 2);
    expect(result).toHaveLength(1);
    expect(result[0].faction.slug).toBe("f0");
    expect(result[0].fallTimestamp).toBe("2026-01-02T00:00:00Z");
  });

  it("sorts fallen factions newest-first", () => {
    const factions = fakeFactions();
    const layers = [
      layer("arrive-0", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-100, -100]] },
      ]),
      layer("arrive-1", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: "f1", hexes: [[-101, -101]] },
      ]),
      layer("fall-0", "2026-01-03T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
      layer("fall-1", "2026-01-04T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-101, -101]] },
      ]),
    ];
    const state = computeFallenStateByCursor(factions, layers);
    const result = fallenAtCursor(factions, layers, state, 4);
    expect(result.map((e) => e.faction.slug)).toEqual(["f1", "f0"]);
  });

  it("clamps an out-of-range cursor", () => {
    const factions = fakeFactions();
    const layers = [
      layer("arrive", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "f0", hexes: [[-100, -100]] },
      ]),
      layer("fall", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[-100, -100]] },
      ]),
    ];
    const state = computeFallenStateByCursor(factions, layers);
    expect(fallenAtCursor(factions, layers, state, 99)).toHaveLength(1);
    expect(fallenAtCursor(factions, layers, state, -5)).toHaveLength(0);
  });
});
