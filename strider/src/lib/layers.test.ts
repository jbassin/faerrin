import { describe, it, expect } from "vitest";
import {
  foldFactionOverrides,
  foldRegions,
  foldSkein,
  getAllLayers,
  getCurrentRegions,
  getCurrentSkein,
  type Layer,
} from "./layers";

function layer(
  slug: string,
  timestamp: string,
  changes: Layer["changes"],
): Layer {
  return { slug, timestamp, message: "", changes, body: "" };
}

describe("foldRegions", () => {
  it("returns an empty array when there are no layers", () => {
    expect(foldRegions([])).toEqual([]);
  });

  it("applies a single add", () => {
    const result = foldRegions([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "add",
          slug: "hq",
          name: "HQ",
          faction: "alkahest-freight",
          hexes: [[1, 0]],
        },
      ]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "hq",
      name: "HQ",
      faction: "alkahest-freight",
      hexes: [[1, 0]],
    });
  });

  it("update only changes provided fields, leaving others intact", () => {
    const result = foldRegions([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "add",
          slug: "hq",
          name: "HQ",
          faction: "alkahest-freight",
          hexes: [[1, 0]],
        },
      ]),
      layer("two", "2026-01-02T00:00:00Z", [
        { op: "update", slug: "hq", name: "New HQ" },
      ]),
    ]);
    expect(result[0].name).toBe("New HQ");
    expect(result[0].faction).toBe("alkahest-freight");
    expect(result[0].hexes).toEqual([[1, 0]]);
  });

  it("update can replace hexes", () => {
    const result = foldRegions([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "add",
          slug: "hq",
          name: "HQ",
          faction: "alkahest-freight",
          hexes: [[1, 0]],
        },
      ]),
      layer("two", "2026-01-02T00:00:00Z", [
        {
          op: "update",
          slug: "hq",
          hexes: [
            [2, 0],
            [3, 0],
          ],
        },
      ]),
    ]);
    expect(result[0].hexes).toEqual([
      [2, 0],
      [3, 0],
    ]);
    expect(result[0].name).toBe("HQ");
  });

  it("remove deletes the region", () => {
    const result = foldRegions([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "add",
          slug: "hq",
          name: "HQ",
          faction: "alkahest-freight",
          hexes: [[1, 0]],
        },
        { op: "remove", slug: "hq" },
      ]),
    ]);
    expect(result).toEqual([]);
  });

  it("throws when adding a slug that already exists", () => {
    expect(() =>
      foldRegions([
        layer("one", "2026-01-01T00:00:00Z", [
          { op: "add", slug: "hq", name: "HQ", faction: "a", hexes: [[0, 0]] },
          { op: "add", slug: "hq", name: "HQ2", faction: "a", hexes: [[1, 0]] },
        ]),
      ]),
    ).toThrow(/already exists/);
  });

  it("throws when updating a slug that does not exist", () => {
    expect(() =>
      foldRegions([
        layer("one", "2026-01-01T00:00:00Z", [
          { op: "update", slug: "ghost", name: "X" },
        ]),
      ]),
    ).toThrow(/does not exist/);
  });

  it("throws when removing a slug that does not exist", () => {
    expect(() =>
      foldRegions([
        layer("one", "2026-01-01T00:00:00Z", [{ op: "remove", slug: "ghost" }]),
      ]),
    ).toThrow(/does not exist/);
  });

  it("returns regions sorted by slug", () => {
    const result = foldRegions([
      layer("one", "2026-01-01T00:00:00Z", [
        { op: "add", slug: "zeta", name: "Z", faction: "a", hexes: [[0, 0]] },
        { op: "add", slug: "alpha", name: "A", faction: "a", hexes: [[1, 0]] },
      ]),
    ]);
    expect(result.map((r) => r.slug)).toEqual(["alpha", "zeta"]);
  });
});

describe("getAllLayers", () => {
  it("returns layers sorted by timestamp ascending", async () => {
    const layers = await getAllLayers();
    const timestamps = layers.map((l) => l.timestamp);
    expect(timestamps).toEqual([...timestamps].sort());
  });
});

describe("getCurrentRegions", () => {
  it("every returned region references a real-looking faction slug and at least one hex", async () => {
    const regions = await getCurrentRegions();
    for (const region of regions) {
      expect(region.slug).not.toBe("");
      expect(region.name).not.toBe("");
      expect(region.faction).not.toBe("");
      expect(region.hexes.length).toBeGreaterThan(0);
    }
  });
});

describe("foldSkein", () => {
  it("returns an empty state when there are no layers", () => {
    expect(foldSkein([])).toEqual({ regions: [], connections: [] });
  });

  it("ignores plain region ops", () => {
    const result = foldSkein([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "add",
          slug: "hq",
          name: "HQ",
          faction: "a",
          hexes: [[0, 0]],
        },
      ]),
    ]);
    expect(result).toEqual({ regions: [], connections: [] });
  });

  it("skein-add inserts a region", () => {
    const result = foldSkein([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "skein-add",
          slug: "relay",
          name: "Relay",
          faction: "a",
          hex: [1, 2],
          symbol: "symbols/relay.svg",
        },
      ]),
    ]);
    expect(result.regions).toEqual([
      {
        slug: "relay",
        name: "Relay",
        faction: "a",
        hex: [1, 2],
        symbol: "symbols/relay.svg",
      },
    ]);
  });

  it("skein-update only changes provided fields", () => {
    const result = foldSkein([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "skein-add",
          slug: "relay",
          name: "Relay",
          faction: "a",
          hex: [1, 2],
          symbol: "symbols/relay.svg",
        },
      ]),
      layer("two", "2026-01-02T00:00:00Z", [
        { op: "skein-update", slug: "relay", name: "Relay-2" },
      ]),
    ]);
    expect(result.regions[0]).toMatchObject({
      slug: "relay",
      name: "Relay-2",
      faction: "a",
      hex: [1, 2],
      symbol: "symbols/relay.svg",
    });
  });

  it("skein-remove deletes the region but keeps stray connections", () => {
    const result = foldSkein([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "skein-add",
          slug: "a",
          name: "A",
          faction: "f",
          hex: [0, 0],
          symbol: "symbols/a.svg",
        },
        {
          op: "skein-add",
          slug: "b",
          name: "B",
          faction: "f",
          hex: [1, 0],
          symbol: "symbols/b.svg",
        },
        { op: "skein-connect", from: "a", to: "b" },
        { op: "skein-remove", slug: "a" },
      ]),
    ]);
    expect(result.regions.map((r) => r.slug)).toEqual(["b"]);
    expect(result.connections).toEqual([{ from: "a", to: "b" }]);
  });

  it("skein-connect canonicalizes pairs and dedupes", () => {
    const result = foldSkein([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "skein-add",
          slug: "a",
          name: "A",
          faction: "f",
          hex: [0, 0],
          symbol: "symbols/a.svg",
        },
        {
          op: "skein-add",
          slug: "b",
          name: "B",
          faction: "f",
          hex: [1, 0],
          symbol: "symbols/b.svg",
        },
        { op: "skein-connect", from: "b", to: "a" },
        { op: "skein-connect", from: "a", to: "b" },
      ]),
    ]);
    expect(result.connections).toEqual([{ from: "a", to: "b" }]);
  });

  it("skein-disconnect removes a connection", () => {
    const result = foldSkein([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "skein-add",
          slug: "a",
          name: "A",
          faction: "f",
          hex: [0, 0],
          symbol: "symbols/a.svg",
        },
        {
          op: "skein-add",
          slug: "b",
          name: "B",
          faction: "f",
          hex: [1, 0],
          symbol: "symbols/b.svg",
        },
        { op: "skein-connect", from: "a", to: "b" },
        { op: "skein-disconnect", from: "b", to: "a" },
      ]),
    ]);
    expect(result.connections).toEqual([]);
  });

  it("throws when skein-connect references self", () => {
    expect(() =>
      foldSkein([
        layer("one", "2026-01-01T00:00:00Z", [
          { op: "skein-connect", from: "a", to: "a" },
        ]),
      ]),
    ).toThrow(/itself/);
  });

  it("throws when skein-disconnect targets a pair that isn't connected", () => {
    expect(() =>
      foldSkein([
        layer("one", "2026-01-01T00:00:00Z", [
          { op: "skein-disconnect", from: "a", to: "b" },
        ]),
      ]),
    ).toThrow(/not connected/);
  });

  it("throws when skein-add reuses an existing slug", () => {
    expect(() =>
      foldSkein([
        layer("one", "2026-01-01T00:00:00Z", [
          {
            op: "skein-add",
            slug: "x",
            name: "X",
            faction: "f",
            hex: [0, 0],
            symbol: "symbols/x.svg",
          },
          {
            op: "skein-add",
            slug: "x",
            name: "X2",
            faction: "f",
            hex: [1, 0],
            symbol: "symbols/x.svg",
          },
        ]),
      ]),
    ).toThrow(/already exists/);
  });
});

describe("getCurrentSkein", () => {
  it("returns a well-formed state object", async () => {
    const skein = await getCurrentSkein();
    expect(skein).toHaveProperty("regions");
    expect(skein).toHaveProperty("connections");
    expect(Array.isArray(skein.regions)).toBe(true);
    expect(Array.isArray(skein.connections)).toBe(true);
  });
});

describe("foldFactionOverrides", () => {
  it("returns an empty map when there are no layers", () => {
    expect(foldFactionOverrides([]).size).toBe(0);
  });

  it("records the claim's faction per hex", () => {
    const result = foldFactionOverrides([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "claim",
          faction: "alkahest-freight",
          hexes: [
            [0, 0],
            [1, 0],
          ],
        },
      ]),
    ]);
    expect(result.get("0,0")).toBe("alkahest-freight");
    expect(result.get("1,0")).toBe("alkahest-freight");
    expect(result.size).toBe(2);
  });

  it("last claim wins for the same hex across layers", () => {
    const result = foldFactionOverrides([
      layer("one", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: "a", hexes: [[0, 0]] },
      ]),
      layer("two", "2026-01-02T00:00:00Z", [
        { op: "claim", faction: "b", hexes: [[0, 0]] },
      ]),
    ]);
    expect(result.get("0,0")).toBe("b");
  });

  it("preserves explicit null as a distinct value from absent", () => {
    const result = foldFactionOverrides([
      layer("one", "2026-01-01T00:00:00Z", [
        { op: "claim", faction: null, hexes: [[5, -2]] },
      ]),
    ]);
    expect(result.has("5,-2")).toBe(true);
    expect(result.get("5,-2")).toBeNull();
    expect(result.has("0,0")).toBe(false);
  });

  it("ignores non-claim ops", () => {
    const result = foldFactionOverrides([
      layer("one", "2026-01-01T00:00:00Z", [
        {
          op: "add",
          slug: "hq",
          name: "HQ",
          faction: "a",
          hexes: [[0, 0]],
        },
      ]),
    ]);
    expect(result.size).toBe(0);
  });
});
