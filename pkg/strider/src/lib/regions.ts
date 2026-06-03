// Pure region types + fold. No Node deps — safe to import from client bundles.

export interface Region {
  slug: string;
  name: string;
  faction: string;
  hexes: ReadonlyArray<readonly [number, number]>;
}

export interface SkeinRegion {
  slug: string;
  name: string;
  faction: string;
  hex: readonly [number, number];
  symbol: string;
}

export interface SkeinConnection {
  from: string;
  to: string;
}

export interface SkeinState {
  regions: SkeinRegion[];
  connections: SkeinConnection[];
}

export type Change =
  | {
      op: "add";
      slug: string;
      name: string;
      faction: string;
      hexes: Array<[number, number]>;
    }
  | {
      op: "update";
      slug: string;
      name?: string;
      faction?: string;
      hexes?: Array<[number, number]>;
    }
  | { op: "remove"; slug: string }
  | {
      op: "skein-add";
      slug: string;
      name: string;
      faction: string;
      hex: [number, number];
      symbol: string;
    }
  | {
      op: "skein-update";
      slug: string;
      name?: string;
      faction?: string;
      hex?: [number, number];
      symbol?: string;
    }
  | { op: "skein-remove"; slug: string }
  | { op: "skein-connect"; from: string; to: string }
  | { op: "skein-disconnect"; from: string; to: string }
  | {
      op: "claim";
      hexes: Array<[number, number]>;
      faction: string | null;
    };

export interface Layer {
  slug: string;
  timestamp: string;
  message: string;
  changes: Change[];
  body: string;
}

// One-shot animation hint passed from MapView to HexMap when the timeline
// advances by exactly one forward step. Carries the just-applied layer's
// changes already partitioned by visual effect so HexMap doesn't need to
// re-walk the discriminated union.
export interface FactionFlipAnim {
  originHex: readonly [number, number];
  hexes: ReadonlyArray<readonly [number, number]>;
  // List of ["q,r", prev faction idx | null] for each animating hex.
  prevFactionIdxByHex: ReadonlyArray<readonly [string, number | null]>;
}

export interface LayerAnimation {
  layerIndex: number;
  budgetMs: number;
  regionAdds: ReadonlyArray<{ slug: string }>;
  skeinConnects: ReadonlyArray<{ from: string; to: string }>;
  factionFlips: ReadonlyArray<FactionFlipAnim>;
}

export function foldRegions(layers: Layer[]): Region[] {
  const state = new Map<string, Region>();
  for (const layer of layers) {
    for (const change of layer.changes) {
      if (change.op === "add") {
        if (state.has(change.slug)) {
          throw new Error(
            `layer ${layer.slug}: cannot add region '${change.slug}' — already exists`,
          );
        }
        state.set(change.slug, {
          slug: change.slug,
          name: change.name,
          faction: change.faction,
          hexes: change.hexes,
        });
      } else if (change.op === "update") {
        const existing = state.get(change.slug);
        if (!existing) {
          throw new Error(
            `layer ${layer.slug}: cannot update region '${change.slug}' — does not exist`,
          );
        }
        state.set(change.slug, {
          slug: existing.slug,
          name: change.name ?? existing.name,
          faction: change.faction ?? existing.faction,
          hexes: change.hexes ?? existing.hexes,
        });
      } else if (change.op === "remove") {
        if (!state.has(change.slug)) {
          throw new Error(
            `layer ${layer.slug}: cannot remove region '${change.slug}' — does not exist`,
          );
        }
        state.delete(change.slug);
      }
    }
  }
  return Array.from(state.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// Walks every layer's `claim` ops in chronological order, recording the latest
// per-hex ownership. The map distinguishes "absent" (no claim ever touched this
// hex — falls back to the static base assignment) from `null` (explicitly
// unowned). Key is the canonical "q,r" hex string.
export function foldFactionOverrides(
  layers: Layer[],
): Map<string, string | null> {
  const overrides = new Map<string, string | null>();
  for (const layer of layers) {
    for (const change of layer.changes) {
      if (change.op === "claim") {
        for (const [q, r] of change.hexes) {
          overrides.set(`${q},${r}`, change.faction);
        }
      }
    }
  }
  return overrides;
}

export function foldSkein(layers: Layer[]): SkeinState {
  const regions = new Map<string, SkeinRegion>();
  const connections = new Set<string>(); // "from|to" canonical

  for (const layer of layers) {
    for (const change of layer.changes) {
      if (change.op === "skein-add") {
        if (regions.has(change.slug)) {
          throw new Error(
            `layer ${layer.slug}: cannot skein-add '${change.slug}' — already exists`,
          );
        }
        regions.set(change.slug, {
          slug: change.slug,
          name: change.name,
          faction: change.faction,
          hex: change.hex,
          symbol: change.symbol,
        });
      } else if (change.op === "skein-update") {
        const existing = regions.get(change.slug);
        if (!existing) {
          throw new Error(
            `layer ${layer.slug}: cannot skein-update '${change.slug}' — does not exist`,
          );
        }
        regions.set(change.slug, {
          slug: existing.slug,
          name: change.name ?? existing.name,
          faction: change.faction ?? existing.faction,
          hex: change.hex ?? existing.hex,
          symbol: change.symbol ?? existing.symbol,
        });
      } else if (change.op === "skein-remove") {
        if (!regions.has(change.slug)) {
          throw new Error(
            `layer ${layer.slug}: cannot skein-remove '${change.slug}' — does not exist`,
          );
        }
        regions.delete(change.slug);
      } else if (change.op === "skein-connect") {
        if (change.from === change.to) {
          throw new Error(
            `layer ${layer.slug}: cannot skein-connect '${change.from}' to itself`,
          );
        }
        const [a, b] = canonicalPair(change.from, change.to);
        connections.add(`${a}|${b}`);
      } else if (change.op === "skein-disconnect") {
        const [a, b] = canonicalPair(change.from, change.to);
        const key = `${a}|${b}`;
        if (!connections.has(key)) {
          throw new Error(
            `layer ${layer.slug}: cannot skein-disconnect '${change.from}'↔'${change.to}' — not connected`,
          );
        }
        connections.delete(key);
      }
    }
  }

  const sortedRegions = Array.from(regions.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
  const sortedConnections = Array.from(connections)
    .map((key) => {
      const [from, to] = key.split("|");
      return { from, to } as SkeinConnection;
    })
    .sort((a, b) =>
      a.from === b.from
        ? a.to.localeCompare(b.to)
        : a.from.localeCompare(b.from),
    );

  return { regions: sortedRegions, connections: sortedConnections };
}
