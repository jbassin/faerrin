import type { Faction } from "@/lib/factions";
import type { Layer } from "@/lib/regions";
import { FACTION_HEXES } from "@/lib/hexUtils";

export interface FallenEntry {
  faction: Faction;
  fallTimestamp: string;
  fallLayerIdx: number;
}

// Per-cursor per-faction "fall layer index" (or null = currently present).
// Index by cursor 0..layers.length, then by faction index. Cursor C corresponds
// to "after applying the first C layers". Stored as a single forward walk so
// recoveries followed by later falls record the most recent fall accurately.
export function computeFallenStateByCursor(
  factions: Faction[],
  layers: Layer[],
): Array<Array<number | null>> {
  const factionSlugs = factions.map((f) => f.slug);
  const slugToIdx = new Map<string, number>();
  factionSlugs.forEach((slug, i) => slugToIdx.set(slug, i));

  const baseOwnerByHex = new Map<string, number>();
  for (let baseIdx = 0; baseIdx < FACTION_HEXES.length; baseIdx++) {
    for (const [q, r] of FACTION_HEXES[baseIdx]) {
      baseOwnerByHex.set(`${q},${r}`, baseIdx);
    }
  }

  const counts = factions.map((_, i) => FACTION_HEXES[i]?.length ?? 0);
  const hasEverHadHexes = counts.map((c) => c > 0);
  const overrides = new Map<string, string | null>();
  const currentFallLayer: Array<number | null> = factions.map(() => null);

  const out: Array<Array<number | null>> = [];
  out.push([...currentFallLayer]);

  const ownerIdxOf = (key: string): number | null => {
    if (overrides.has(key)) {
      const target = overrides.get(key) ?? null;
      if (target === null) return null;
      return slugToIdx.get(target) ?? null;
    }
    return baseOwnerByHex.get(key) ?? null;
  };

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    for (const change of layer.changes) {
      if (change.op !== "claim") continue;
      for (const [q, r] of change.hexes) {
        const key = `${q},${r}`;
        const prevOwner = ownerIdxOf(key);
        if (prevOwner !== null) counts[prevOwner]--;
        overrides.set(key, change.faction);
        const newOwner = ownerIdxOf(key);
        if (newOwner !== null) counts[newOwner]++;
      }
    }

    counts.forEach((c, idx) => {
      if (c > 0) {
        hasEverHadHexes[idx] = true;
        currentFallLayer[idx] = null;
      } else if (hasEverHadHexes[idx] && currentFallLayer[idx] === null) {
        currentFallLayer[idx] = li + 1;
      }
    });

    out.push([...currentFallLayer]);
  }

  return out;
}

export function fallenAtCursor(
  factions: Faction[],
  layers: Layer[],
  fallenStateByCursor: Array<Array<number | null>>,
  cursor: number,
): FallenEntry[] {
  const clamped = Math.max(0, Math.min(cursor, fallenStateByCursor.length - 1));
  const state = fallenStateByCursor[clamped];
  const entries: FallenEntry[] = [];
  state.forEach((fallLayerIdx, idx) => {
    if (fallLayerIdx === null) return;
    const layer = layers[fallLayerIdx - 1];
    if (!layer) return;
    entries.push({
      faction: factions[idx],
      fallTimestamp: layer.timestamp,
      fallLayerIdx,
    });
  });
  entries.sort((a, b) => b.fallLayerIdx - a.fallLayerIdx);
  return entries;
}
