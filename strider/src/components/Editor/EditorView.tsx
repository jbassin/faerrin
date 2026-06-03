import { lazy, useCallback, useMemo, useReducer, useState } from "react";
import type { Faction } from "@/lib/factions";
import type { Region, SkeinRegion, SkeinState } from "@/lib/layers";
import type { EditableChange } from "@/lib/editorHelpers";
import { hexFactionMap, hexRegionMap } from "@/lib/editorHelpers";
import ClientOnly from "@/components/ClientOnly/ClientOnly";
import { initialState, reducer, type Mode } from "./editorReducer";
import {
  handleAddClick,
  handleClaimClick,
  handleRemoveClick,
  handleUpdateClick,
  handleSkeinAddClick,
  handleSkeinConnectClick,
  handleSkeinRemoveClick,
  type HexClickContext,
} from "./modeHandlers";
import { saveLayer } from "./saveLayer";
import styles from "./EditorView.module.css";

const EditorHexMap = lazy(() => import("./EditorHexMap"));

const DEFAULT_SKEIN_SYMBOL = "symbols/skein-eye.svg";

type Kind = "region" | "skein" | "base";

const KIND_MODES: Record<Kind, ReadonlyArray<Mode>> = {
  region: ["add", "update", "remove"],
  skein: ["skein-add", "skein-connect", "skein-remove"],
  base: ["claim"],
};

const MODE_LABELS: Record<Mode, string> = {
  add: "add",
  update: "update",
  remove: "remove",
  "skein-add": "add",
  "skein-connect": "connect",
  "skein-remove": "remove",
  claim: "claim",
};

const KIND_DEFAULT_MODE: Record<Kind, Mode> = {
  region: "add",
  skein: "skein-add",
  base: "claim",
};

interface EditorViewProps {
  factions: Faction[];
  regions: Region[];
  skein: SkeinState;
}

export default function EditorView({
  factions,
  regions,
  skein,
}: EditorViewProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [kind, setKind] = useState<Kind>("region");

  const hexFaction = useMemo(() => hexFactionMap(), []);
  const hexRegion = useMemo(() => hexRegionMap(regions), [regions]);
  const skeinByHex = useMemo<Map<string, SkeinRegion>>(() => {
    const m = new Map<string, SkeinRegion>();
    for (const node of skein.regions) {
      m.set(`${node.hex[0]},${node.hex[1]}`, node);
    }
    return m;
  }, [skein]);
  const skeinBySlug = useMemo<Map<string, SkeinRegion>>(() => {
    const m = new Map<string, SkeinRegion>();
    for (const node of skein.regions) m.set(node.slug, node);
    return m;
  }, [skein]);

  const factionIdxForSelection = useMemo<number | null>(() => {
    if (state.selectedHexes.length === 0) return null;
    const [q, r] = state.selectedHexes[0];
    return hexFaction.get(`${q},${r}`) ?? null;
  }, [state.selectedHexes, hexFaction]);
  const selectionFaction =
    factionIdxForSelection !== null ? factions[factionIdxForSelection] : null;

  const pickedRegion = useMemo<Region | null>(
    () =>
      state.pickedRegionSlug
        ? (regions.find((r) => r.slug === state.pickedRegionSlug) ?? null)
        : null,
    [state.pickedRegionSlug, regions],
  );

  const pickedSkein = state.pickedSkeinSlug
    ? (skeinBySlug.get(state.pickedSkeinSlug) ?? null)
    : null;
  const connectFromSkein = state.skeinConnectFrom
    ? (skeinBySlug.get(state.skeinConnectFrom) ?? null)
    : null;

  const switchKind = useCallback((k: Kind) => {
    setKind(k);
    dispatch({ type: "switchMode", mode: KIND_DEFAULT_MODE[k] });
  }, []);

  const handleHexClick = useCallback(
    (q: number, r: number) => {
      const ctx: HexClickContext = {
        state,
        factions,
        regions,
        skein,
        hexFaction,
        hexRegion,
        skeinByHex,
        factionIdxForSelection,
        pickedRegion,
        dispatch,
      };
      switch (state.mode) {
        case "add":
          handleAddClick(ctx, q, r);
          break;
        case "update":
          handleUpdateClick(ctx, q, r);
          break;
        case "remove":
          handleRemoveClick(ctx, q, r);
          break;
        case "skein-add":
          handleSkeinAddClick(ctx, q, r);
          break;
        case "skein-connect":
          handleSkeinConnectClick(ctx, q, r);
          break;
        case "skein-remove":
          handleSkeinRemoveClick(ctx, q, r);
          break;
        case "claim":
          handleClaimClick(ctx, q, r);
          break;
      }
    },
    [
      state,
      factions,
      regions,
      skein,
      hexFaction,
      hexRegion,
      skeinByHex,
      factionIdxForSelection,
      pickedRegion,
    ],
  );

  const draftChange = useMemo<EditableChange | null>(
    () => computeDraftChange(state, selectionFaction, pickedRegion, skeinByHex),
    [state, selectionFaction, pickedRegion, skeinByHex],
  );

  const canSave =
    draftChange !== null && state.logMessage.trim().length > 0 && !state.saving;

  const handleSave = useCallback(async () => {
    if (!draftChange) return;
    dispatch({ type: "startSaving" });
    try {
      await saveLayer({
        draftChange,
        logMessage: state.logMessage,
        timestamp: state.timestamp,
      });
      dispatch({ type: "saveSucceeded" });
      // contentWatchPlugin regenerates src/generated/layers.ts when the file
      // lands on disk; Vite's HMR cascade replaces the import.
    } catch (err) {
      dispatch({
        type: "saveFailed",
        error: err instanceof Error ? err.message : "save failed",
      });
    }
  }, [draftChange, state.logMessage, state.timestamp]);

  const pickedFactionForSkein = pickedSkein
    ? (factions.find((f) => f.slug === pickedSkein.faction) ?? null)
    : null;

  return (
    <div className={styles.root}>
      <div className={styles.mapColumn}>
        <ClientOnly>
          <EditorHexMap
            factions={factions}
            regions={regions}
            skein={skein}
            selectedHexes={state.selectedHexes}
            pickedRegionSlug={state.pickedRegionSlug}
            pickedSkeinSlug={state.pickedSkeinSlug}
            skeinConnectFrom={state.skeinConnectFrom}
            onHexClick={handleHexClick}
          />
        </ClientOnly>
      </div>

      <aside className={styles.panel}>
        <span className={styles.cornerTL} aria-hidden="true">
          +
        </span>
        <span className={styles.cornerTR} aria-hidden="true">
          +
        </span>
        <span className={styles.cornerBL} aria-hidden="true">
          +
        </span>
        <span className={styles.cornerBR} aria-hidden="true">
          +
        </span>
        <header className={styles.panelHeader}>
          <div className={styles.headerRibbon}>
            <span className={styles.headerHair} aria-hidden="true" />
            <span className={styles.headerTitle}>++ LAYER FORGE ++</span>
            <span className={styles.headerHair} aria-hidden="true" />
          </div>
          <div className={styles.subtitle}>
            · dev-only · writes to <code>content/layers/</code>
          </div>
        </header>

        <div className={styles.modeRow}>
          {(["region", "skein", "base"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={kind === k ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => switchKind(k)}
            >
              {k}
            </button>
          ))}
        </div>

        <div className={styles.modeRow}>
          {KIND_MODES[kind].map((m) => (
            <button
              key={m}
              type="button"
              className={
                state.mode === m ? styles.modeBtnActive : styles.modeBtn
              }
              onClick={() => dispatch({ type: "switchMode", mode: m })}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {state.mode === "add" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              Click hexes to toggle them into the new region.
            </div>
            <label className={styles.field}>
              <span>Region name</span>
              <input
                type="text"
                value={state.regionName}
                onChange={(e) =>
                  dispatch({ type: "setRegionName", value: e.target.value })
                }
                placeholder="Alkahest HQ"
              />
            </label>
            <label className={styles.field}>
              <span>Slug</span>
              <input
                type="text"
                value={state.regionSlug}
                onChange={(e) =>
                  dispatch({ type: "setRegionSlug", value: e.target.value })
                }
                placeholder="alkahest-hq"
              />
            </label>
            <div className={styles.readout}>
              <span>Faction</span>
              <span>{selectionFaction?.name ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>Hexes</span>
              <span>{state.selectedHexes.length}</span>
            </div>
          </section>
        )}

        {state.mode === "update" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              {pickedRegion
                ? "Click hexes to toggle membership, or change the name."
                : "Click a hex inside an existing region to start editing it."}
            </div>
            <label className={styles.field}>
              <span>Region name</span>
              <input
                type="text"
                value={state.regionName}
                onChange={(e) =>
                  dispatch({ type: "setRegionName", value: e.target.value })
                }
                disabled={!pickedRegion}
              />
            </label>
            <div className={styles.readout}>
              <span>Slug</span>
              <span>{pickedRegion?.slug ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>Faction</span>
              <span>
                {pickedRegion
                  ? (factions.find((f) => f.slug === pickedRegion.faction)
                      ?.name ?? "—")
                  : "—"}
              </span>
            </div>
            <div className={styles.readout}>
              <span>Hexes</span>
              <span>{state.selectedHexes.length}</span>
            </div>
          </section>
        )}

        {state.mode === "remove" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              {pickedRegion
                ? `Will remove "${pickedRegion.name}".`
                : "Click a hex inside a region to mark it for removal."}
            </div>
            <div className={styles.readout}>
              <span>Region</span>
              <span>{pickedRegion?.name ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>Slug</span>
              <span>{pickedRegion?.slug ?? "—"}</span>
            </div>
          </section>
        )}

        {state.mode === "skein-add" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              Click a hex to place a new Skein node.
            </div>
            <label className={styles.field}>
              <span>Node name</span>
              <input
                type="text"
                value={state.regionName}
                onChange={(e) =>
                  dispatch({ type: "setRegionName", value: e.target.value })
                }
                placeholder="Signal Relay"
              />
            </label>
            <label className={styles.field}>
              <span>Slug</span>
              <input
                type="text"
                value={state.regionSlug}
                onChange={(e) =>
                  dispatch({ type: "setRegionSlug", value: e.target.value })
                }
                placeholder="signal-relay"
              />
            </label>
            <div className={styles.readout}>
              <span>Faction</span>
              <span>{selectionFaction?.name ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>Hex</span>
              <span>
                {state.selectedHexes[0]
                  ? `[${state.selectedHexes[0][0]}, ${state.selectedHexes[0][1]}]`
                  : "—"}
              </span>
            </div>
            <div className={styles.readout}>
              <span>Symbol</span>
              <span>{DEFAULT_SKEIN_SYMBOL}</span>
            </div>
          </section>
        )}

        {state.mode === "skein-connect" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              {!connectFromSkein
                ? "Click two Skein nodes to connect them."
                : !pickedSkein
                  ? "Now click a second Skein node."
                  : `Will link "${connectFromSkein.name}" ↔ "${pickedSkein.name}".`}
            </div>
            <div className={styles.readout}>
              <span>From</span>
              <span>{connectFromSkein?.name ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>To</span>
              <span>{pickedSkein?.name ?? "—"}</span>
            </div>
          </section>
        )}

        {state.mode === "skein-remove" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              {pickedSkein
                ? `Will remove "${pickedSkein.name}".`
                : "Click a Skein node to mark it for removal."}
            </div>
            <div className={styles.readout}>
              <span>Node</span>
              <span>{pickedSkein?.name ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>Slug</span>
              <span>{pickedSkein?.slug ?? "—"}</span>
            </div>
            <div className={styles.readout}>
              <span>Faction</span>
              <span>{pickedFactionForSkein?.name ?? "—"}</span>
            </div>
          </section>
        )}

        {state.mode === "claim" && (
          <section className={styles.section}>
            <div className={styles.hint}>
              Click hexes to toggle them, then pick the new owner.
            </div>
            <label className={styles.field}>
              <span>New owner</span>
              <select
                value={state.targetFaction ?? ""}
                onChange={(e) =>
                  dispatch({
                    type: "setTargetFaction",
                    value: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">— None —</option>
                {factions.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.readout}>
              <span>Hexes</span>
              <span>{state.selectedHexes.length}</span>
            </div>
          </section>
        )}

        <section className={styles.section}>
          <label className={styles.field}>
            <span>Log message</span>
            <input
              type="text"
              value={state.logMessage}
              onChange={(e) =>
                dispatch({ type: "setLogMessage", value: e.target.value })
              }
              placeholder="Alkahest opens a new HQ on the docks."
            />
          </label>
          <label className={styles.field}>
            <span>Timestamp</span>
            <input
              type="text"
              value={state.timestamp}
              onChange={(e) =>
                dispatch({ type: "setTimestamp", value: e.target.value })
              }
            />
          </label>
        </section>

        {draftChange && (
          <div className={styles.preview}>
            {draftChange.op === "add" && (
              <>
                + add <strong>{draftChange.slug}</strong> &ldquo;
                {draftChange.name}&rdquo; ({draftChange.faction},{" "}
                {draftChange.hexes.length} hexes)
              </>
            )}
            {draftChange.op === "update" && (
              <>
                ~ update <strong>{draftChange.slug}</strong> (
                {[
                  draftChange.name !== undefined && "name",
                  draftChange.hexes !== undefined &&
                    `${draftChange.hexes.length} hexes`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                )
              </>
            )}
            {draftChange.op === "remove" && (
              <>
                − remove <strong>{draftChange.slug}</strong>
              </>
            )}
            {draftChange.op === "skein-add" && (
              <>
                + add skein <strong>{draftChange.slug}</strong> &ldquo;
                {draftChange.name}&rdquo; ({draftChange.faction}, [
                {draftChange.hex[0]}, {draftChange.hex[1]}])
              </>
            )}
            {draftChange.op === "skein-connect" && (
              <>
                ~ link <strong>{draftChange.from}</strong> ↔{" "}
                <strong>{draftChange.to}</strong>
              </>
            )}
            {draftChange.op === "skein-remove" && (
              <>
                − remove skein <strong>{draftChange.slug}</strong>
              </>
            )}
            {draftChange.op === "claim" && (
              <>
                ~ claim {draftChange.hexes.length} hexes →{" "}
                <strong>
                  {draftChange.faction === null
                    ? "None"
                    : (factions.find((f) => f.slug === draftChange.faction)
                        ?.name ?? draftChange.faction)}
                </strong>
              </>
            )}
          </div>
        )}

        {state.error && <div className={styles.error}>{state.error}</div>}

        <button
          type="button"
          className={styles.saveBtn}
          disabled={!canSave}
          onClick={handleSave}
        >
          {state.saving ? "Saving…" : "Save vox-cast"}
        </button>
      </aside>
    </div>
  );
}

function computeDraftChange(
  state: {
    mode: Mode;
    regionSlug: string;
    regionName: string;
    selectedHexes: Array<[number, number]>;
    pickedSkeinSlug: string | null;
    skeinConnectFrom: string | null;
    targetFaction: string | null;
  },
  selectionFaction: Faction | null,
  pickedRegion: Region | null,
  skeinByHex: Map<string, SkeinRegion>,
): EditableChange | null {
  if (state.mode === "add") {
    if (
      !state.regionSlug ||
      !state.regionName ||
      state.selectedHexes.length === 0 ||
      !selectionFaction
    ) {
      return null;
    }
    return {
      op: "add",
      slug: state.regionSlug,
      name: state.regionName,
      faction: selectionFaction.slug,
      hexes: state.selectedHexes.map(([q, r]) => [q, r]),
    };
  }
  if (state.mode === "update") {
    if (!pickedRegion) return null;
    const out: EditableChange = { op: "update", slug: pickedRegion.slug };
    let hasChange = false;
    if (state.regionName.trim() && state.regionName !== pickedRegion.name) {
      out.name = state.regionName;
      hasChange = true;
    }
    const sameHexes =
      state.selectedHexes.length === pickedRegion.hexes.length &&
      state.selectedHexes.every(([q, r]) =>
        pickedRegion.hexes.some(([pq, pr]) => pq === q && pr === r),
      );
    if (!sameHexes && state.selectedHexes.length > 0) {
      out.hexes = state.selectedHexes.map(([q, r]) => [q, r]);
      hasChange = true;
    }
    return hasChange ? out : null;
  }
  if (state.mode === "remove") {
    return pickedRegion ? { op: "remove", slug: pickedRegion.slug } : null;
  }
  if (state.mode === "skein-add") {
    if (
      !state.regionSlug ||
      !state.regionName ||
      state.selectedHexes.length !== 1 ||
      !selectionFaction
    ) {
      return null;
    }
    const [q, r] = state.selectedHexes[0];
    return {
      op: "skein-add",
      slug: state.regionSlug,
      name: state.regionName,
      faction: selectionFaction.slug,
      hex: [q, r],
      symbol: DEFAULT_SKEIN_SYMBOL,
    };
  }
  if (state.mode === "skein-connect") {
    if (!state.skeinConnectFrom || !state.pickedSkeinSlug) return null;
    if (state.skeinConnectFrom === state.pickedSkeinSlug) return null;
    return {
      op: "skein-connect",
      from: state.skeinConnectFrom,
      to: state.pickedSkeinSlug,
    };
  }
  if (state.mode === "skein-remove") {
    if (!state.pickedSkeinSlug) return null;
    return { op: "skein-remove", slug: state.pickedSkeinSlug };
  }
  if (state.mode === "claim") {
    if (state.selectedHexes.length === 0) return null;
    return {
      op: "claim",
      hexes: state.selectedHexes.map(([q, r]) => [q, r]),
      faction: state.targetFaction,
    };
  }
  void skeinByHex;
  return null;
}
