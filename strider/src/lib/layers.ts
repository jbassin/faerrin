import {
  LAYERS,
  CURRENT_REGIONS,
  CURRENT_SKEIN,
  CURRENT_FACTION_HEXES,
  CURRENT_UNOWNED_HEXES,
  CURRENT_FACTION_BORDERS,
  CURRENT_FACTION_TERRITORY_BORDERS,
} from "@/generated/layers";
import {
  foldFactionOverrides,
  foldRegions,
  foldSkein,
  type Change,
  type FactionFlipAnim,
  type Layer,
  type LayerAnimation,
  type Region,
  type SkeinConnection,
  type SkeinRegion,
  type SkeinState,
} from "./regions";

export {
  foldFactionOverrides,
  foldRegions,
  foldSkein,
  CURRENT_FACTION_HEXES,
  CURRENT_UNOWNED_HEXES,
  CURRENT_FACTION_BORDERS,
  CURRENT_FACTION_TERRITORY_BORDERS,
};
export type {
  Change,
  FactionFlipAnim,
  Layer,
  LayerAnimation,
  Region,
  SkeinConnection,
  SkeinRegion,
  SkeinState,
};

export async function getAllLayers(): Promise<Layer[]> {
  return LAYERS as Layer[];
}

export async function getCurrentRegions(): Promise<Region[]> {
  return CURRENT_REGIONS as Region[];
}

export async function getCurrentSkein(): Promise<SkeinState> {
  return CURRENT_SKEIN;
}
