import type { Faction } from "@/lib/factions";
import type { Region, SkeinRegion, SkeinState } from "@/lib/layers";
import type { EditorAction, EditorState } from "./editorReducer";

export interface HexClickContext {
  state: EditorState;
  factions: Faction[];
  regions: Region[];
  skein: SkeinState;
  hexFaction: Map<string, number>;
  hexRegion: Map<string, string>;
  skeinByHex: Map<string, SkeinRegion>;
  factionIdxForSelection: number | null;
  pickedRegion: Region | null;
  dispatch: (action: EditorAction) => void;
}

export function handleAddClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const { state, factions, hexFaction, factionIdxForSelection, dispatch } = ctx;
  dispatch({ type: "setError", error: null });

  const clickedFactionIdx = hexFaction.get(`${q},${r}`) ?? null;
  if (clickedFactionIdx === null) return;

  if (
    factionIdxForSelection !== null &&
    clickedFactionIdx !== factionIdxForSelection
  ) {
    const otherName = factions[clickedFactionIdx].name;
    dispatch({
      type: "setError",
      error: `Region must stay inside one faction; that hex belongs to ${otherName}.`,
    });
    return;
  }

  void state;
  dispatch({ type: "toggleHex", q, r });
}

export function handleRemoveClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const { hexRegion, regions, dispatch } = ctx;
  dispatch({ type: "setError", error: null });

  const clickedRegionSlug = hexRegion.get(`${q},${r}`);
  if (!clickedRegionSlug) {
    dispatch({
      type: "setError",
      error: "Click a hex inside a region to mark it for removal.",
    });
    return;
  }

  const region = regions.find((rg) => rg.slug === clickedRegionSlug);
  if (!region) return;
  dispatch({ type: "pickRegion", slug: region.slug, name: region.name });
}

export function handleUpdateClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const {
    state,
    factions,
    regions,
    hexFaction,
    hexRegion,
    pickedRegion,
    dispatch,
  } = ctx;
  dispatch({ type: "setError", error: null });

  // First click picks the region; subsequent clicks toggle hex membership.
  if (!state.pickedRegionSlug) {
    const clickedRegionSlug = hexRegion.get(`${q},${r}`);
    if (!clickedRegionSlug) {
      dispatch({
        type: "setError",
        error: "Click a hex inside an existing region to start editing it.",
      });
      return;
    }
    const region = regions.find((rg) => rg.slug === clickedRegionSlug);
    if (!region) return;
    dispatch({
      type: "pickRegion",
      slug: region.slug,
      name: region.name,
      regionSlug: region.slug,
      hexes: region.hexes.map(([hq, hr]) => [hq, hr]),
    });
    return;
  }

  // Region already picked — enforce faction lock when toggling hexes.
  const pickedFactionIdx = pickedRegion
    ? factions.findIndex((f) => f.slug === pickedRegion.faction)
    : -1;
  const clickedFactionIdx = hexFaction.get(`${q},${r}`) ?? null;

  if (
    pickedFactionIdx >= 0 &&
    clickedFactionIdx !== null &&
    clickedFactionIdx !== pickedFactionIdx
  ) {
    dispatch({
      type: "setError",
      error: `Region must stay inside ${factions[pickedFactionIdx].name}; that hex belongs to another faction.`,
    });
    return;
  }

  dispatch({ type: "toggleHex", q, r });
}

export function handleSkeinAddClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const { hexFaction, dispatch } = ctx;
  dispatch({ type: "setError", error: null });

  if (hexFaction.get(`${q},${r}`) === undefined) {
    dispatch({
      type: "setError",
      error: "Pick a hex inside a faction's territory.",
    });
    return;
  }
  dispatch({ type: "setSelectedHexes", hexes: [[q, r]] });
}

export function handleSkeinConnectClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const { state, skeinByHex, dispatch } = ctx;
  dispatch({ type: "setError", error: null });

  const node = skeinByHex.get(`${q},${r}`);
  if (!node) {
    dispatch({
      type: "setError",
      error: "Click an existing Skein node.",
    });
    return;
  }

  if (state.skeinConnectFrom === null) {
    dispatch({ type: "setSkeinConnectFrom", slug: node.slug });
    return;
  }

  if (node.slug === state.skeinConnectFrom) {
    dispatch({
      type: "setError",
      error: "Pick a different node for the other endpoint.",
    });
    return;
  }

  dispatch({ type: "pickSkein", slug: node.slug });
}

export function handleClaimClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const { dispatch } = ctx;
  dispatch({ type: "setError", error: null });
  dispatch({ type: "toggleHex", q, r });
}

export function handleSkeinRemoveClick(
  ctx: HexClickContext,
  q: number,
  r: number,
): void {
  const { skeinByHex, dispatch } = ctx;
  dispatch({ type: "setError", error: null });

  const node = skeinByHex.get(`${q},${r}`);
  if (!node) {
    dispatch({
      type: "setError",
      error: "Click an existing Skein node to mark it for removal.",
    });
    return;
  }
  dispatch({ type: "pickSkein", slug: node.slug });
}
