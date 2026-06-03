import { slugify } from "@/lib/editorHelpers";

export type Mode =
  | "add"
  | "update"
  | "remove"
  | "skein-add"
  | "skein-connect"
  | "skein-remove"
  | "claim";

export interface EditorState {
  mode: Mode;
  selectedHexes: Array<[number, number]>;
  pickedRegionSlug: string | null;
  pickedSkeinSlug: string | null;
  skeinConnectFrom: string | null;
  regionName: string;
  regionSlug: string;
  slugTouched: boolean;
  targetFaction: string | null;
  logMessage: string;
  timestamp: string;
  error: string | null;
  saving: boolean;
}

export type EditorAction =
  | { type: "switchMode"; mode: Mode }
  | { type: "resetDraft" }
  | { type: "setSelectedHexes"; hexes: Array<[number, number]> }
  | { type: "toggleHex"; q: number; r: number }
  | {
      type: "pickRegion";
      slug: string;
      name: string;
      regionSlug?: string;
      hexes?: Array<[number, number]>;
    }
  | { type: "pickSkein"; slug: string }
  | { type: "setSkeinConnectFrom"; slug: string | null }
  | { type: "setRegionName"; value: string }
  | { type: "setRegionSlug"; value: string }
  | { type: "setTargetFaction"; value: string | null }
  | { type: "setLogMessage"; value: string }
  | { type: "setTimestamp"; value: string }
  | { type: "setError"; error: string | null }
  | { type: "startSaving" }
  | { type: "saveSucceeded" }
  | { type: "saveFailed"; error: string };

export const DEFAULT_TIMESTAMP = "863-07-14T00:00:00Z";

export const initialState: EditorState = {
  mode: "add",
  selectedHexes: [],
  pickedRegionSlug: null,
  pickedSkeinSlug: null,
  skeinConnectFrom: null,
  regionName: "",
  regionSlug: "",
  slugTouched: false,
  targetFaction: null,
  logMessage: "",
  timestamp: DEFAULT_TIMESTAMP,
  error: null,
  saving: false,
};

function toggleHex(
  hexes: Array<[number, number]>,
  q: number,
  r: number,
): Array<[number, number]> {
  const idx = hexes.findIndex(([pq, pr]) => pq === q && pr === r);
  if (idx >= 0) return hexes.filter((_, i) => i !== idx);
  return [...hexes, [q, r]];
}

function withDraftCleared(state: EditorState): EditorState {
  return {
    ...state,
    selectedHexes: [],
    pickedRegionSlug: null,
    pickedSkeinSlug: null,
    skeinConnectFrom: null,
    regionName: "",
    regionSlug: "",
    slugTouched: false,
    targetFaction: null,
    error: null,
  };
}

export function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "switchMode":
      return withDraftCleared({ ...state, mode: action.mode });
    case "resetDraft":
      return withDraftCleared(state);
    case "setSelectedHexes":
      return { ...state, selectedHexes: action.hexes, error: null };
    case "toggleHex":
      return {
        ...state,
        selectedHexes: toggleHex(state.selectedHexes, action.q, action.r),
        error: null,
      };
    case "pickRegion":
      return {
        ...state,
        pickedRegionSlug: action.slug,
        regionName: action.name,
        regionSlug: action.regionSlug ?? state.regionSlug,
        selectedHexes: action.hexes ?? state.selectedHexes,
        error: null,
      };
    case "pickSkein":
      return { ...state, pickedSkeinSlug: action.slug, error: null };
    case "setSkeinConnectFrom":
      return { ...state, skeinConnectFrom: action.slug, error: null };
    case "setRegionName": {
      const next = { ...state, regionName: action.value };
      if (
        (state.mode === "add" || state.mode === "skein-add") &&
        !state.slugTouched
      ) {
        next.regionSlug = slugify(action.value);
      }
      return next;
    }
    case "setRegionSlug":
      return { ...state, regionSlug: slugify(action.value), slugTouched: true };
    case "setTargetFaction":
      return { ...state, targetFaction: action.value, error: null };
    case "setLogMessage":
      return { ...state, logMessage: action.value };
    case "setTimestamp":
      return { ...state, timestamp: action.value };
    case "setError":
      return { ...state, error: action.error };
    case "startSaving":
      return { ...state, saving: true, error: null };
    case "saveSucceeded":
      return {
        ...withDraftCleared(state),
        logMessage: "",
        timestamp: DEFAULT_TIMESTAMP,
        saving: false,
      };
    case "saveFailed":
      return { ...state, saving: false, error: action.error };
  }
}
