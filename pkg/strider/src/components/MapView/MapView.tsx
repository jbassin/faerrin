import { lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Faction } from "@/lib/factions";
import {
  foldFactionOverrides,
  foldRegions,
  foldSkein,
  type FactionFlipAnim,
  type Layer,
  type LayerAnimation,
} from "@/lib/regions";
import {
  FACTION_HEXES,
  UNOWNED_BASE_HEXES,
  computeAssignmentBorders,
  computeEffectiveAssignments,
} from "@/lib/hexUtils";
import {
  OVERLAYS,
  serializeOverlaysParam,
  type OverlayId,
} from "@/lib/overlays";
import { stepDwellMs } from "@/lib/timeline";
import { useIsMobile } from "@/lib/useIsMobile";
import { computeFallenStateByCursor, fallenAtCursor } from "@/lib/memoriam";
import ClientOnly from "@/components/ClientOnly/ClientOnly";
import Modal from "@/components/Modal/Modal";
import { useSetEntitiesObserved } from "@/components/SiteHeader/entitiesObserved";
import MemoriamPanel from "./MemoriamPanel";
import OverlayStrip from "./OverlayStrip";
import TimelineStrip from "./TimelineStrip";
import { useTimelinePlayback, INITIAL_PAUSE_MS } from "./useTimelinePlayback";
import styles from "./MapView.module.css";

// Lazy so PixiJS never evaluates during SSR. ClientOnly below guarantees
// the lazy boundary only resolves in the browser.
const HexMap = lazy(() => import("@/components/HexMap/HexMap"));

type HoverState =
  | { kind: "none" }
  | { kind: "faction"; factionIdx: number }
  | { kind: "region"; factionIdx: number; slug: string }
  | { kind: "skein"; factionIdx: number; slug: string };

interface MapViewProps {
  factions: Faction[];
  layers: Layer[];
  seen?: boolean;
  initialVisibleOverlays: Set<OverlayId>;
}

export default function MapView({
  factions,
  layers,
  seen,
  initialVisibleOverlays,
}: MapViewProps) {
  const [selectedFaction, setSelectedFaction] = useState<Faction | null>(null);
  const [hover, setHover] = useState<HoverState>({ kind: "none" });
  const [visibleOverlays, setVisibleOverlays] = useState<Set<OverlayId>>(
    () => new Set(initialVisibleOverlays),
  );
  const { layerIndex, prevLayerIndex, isPlaying, setIndex } =
    useTimelinePlayback(layers.length, seen);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const toggleOverlay = useCallback(
    (id: OverlayId) => {
      setVisibleOverlays((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        const serialized = serializeOverlaysParam(next);
        void navigate({
          to: "/",
          search: (s: Record<string, unknown>) => ({
            ...s,
            overlays: serialized,
          }),
          replace: true,
        });
        return next;
      });
    },
    [navigate],
  );

  const regions = useMemo(
    () => foldRegions(layers.slice(0, layerIndex)),
    [layers, layerIndex],
  );

  const skein = useMemo(
    () => foldSkein(layers.slice(0, layerIndex)),
    [layers, layerIndex],
  );

  const factionSlugs = useMemo(() => factions.map((f) => f.slug), [factions]);

  const fallenStateByCursor = useMemo(
    () => computeFallenStateByCursor(factions, layers),
    [factions, layers],
  );

  const fallenEntries = useMemo(
    () => fallenAtCursor(factions, layers, fallenStateByCursor, layerIndex),
    [factions, layers, fallenStateByCursor, layerIndex],
  );

  const setEntitiesObserved = useSetEntitiesObserved();

  const effectiveFactionState = useMemo(() => {
    const overrides = foldFactionOverrides(layers.slice(0, layerIndex));
    const effective = computeEffectiveAssignments(
      FACTION_HEXES,
      UNOWNED_BASE_HEXES,
      overrides,
      factionSlugs,
    );
    const { allBorders, perFaction } = computeAssignmentBorders(
      effective.perFaction,
    );
    return {
      factionHexes: effective.perFaction,
      unownedHexes: effective.unowned,
      factionBorders: allBorders,
      territoryBorders: perFaction,
    };
  }, [layers, layerIndex, factionSlugs]);

  const entitiesObservedCount = useMemo(
    () =>
      effectiveFactionState.factionHexes.reduce(
        (sum, hexes) => (hexes.length > 0 ? sum + 1 : sum),
        0,
      ),
    [effectiveFactionState.factionHexes],
  );

  useEffect(() => {
    setEntitiesObserved(entitiesObservedCount);
    return () => setEntitiesObserved(null);
  }, [entitiesObservedCount, setEntitiesObserved]);

  function handleFactionClick(faction: Faction) {
    if (isMobile) {
      navigate({ to: "/factions/$slug", params: { slug: faction.slug } });
    } else {
      setSelectedFaction(faction);
    }
  }

  function handleFactionHover(factionIdx: number | null) {
    setHover(
      factionIdx === null ? { kind: "none" } : { kind: "faction", factionIdx },
    );
  }

  function handleRegionHover(slug: string | null, factionIdx: number | null) {
    if (slug === null || factionIdx === null) setHover({ kind: "none" });
    else setHover({ kind: "region", factionIdx, slug });
  }

  function handleSkeinHover(slug: string | null, factionIdx: number | null) {
    if (slug === null || factionIdx === null) setHover({ kind: "none" });
    else setHover({ kind: "skein", factionIdx, slug });
  }

  const hoveredFactionIdx = hover.kind === "none" ? null : hover.factionIdx;
  const hoveredRegionSlug = hover.kind === "region" ? hover.slug : null;
  const hoveredSkeinSlug = hover.kind === "skein" ? hover.slug : null;
  const hoveredFaction =
    hoveredFactionIdx !== null ? factions[hoveredFactionIdx] : null;
  const hoveredRegion = hoveredRegionSlug
    ? (regions.find((r) => r.slug === hoveredRegionSlug) ?? null)
    : null;
  const hoveredSkein = hoveredSkeinSlug
    ? (skein.regions.find((r) => r.slug === hoveredSkeinSlug) ?? null)
    : null;

  const dwellMs =
    isPlaying && layerIndex === 0
      ? INITIAL_PAUSE_MS
      : stepDwellMs(Math.max(0, layerIndex - 1));

  // Build a one-shot animation hint when the timeline takes a forward-by-one
  // step. Backward, multi-step, and initial-mount transitions snap (animation
  // is null). The hint lifecycles with `layerIndex` itself — when it changes,
  // a new object reference is passed to HexMap, which keys its scene effect
  // off identity to fire animations exactly once per step.
  const animation: LayerAnimation | null = useMemo(() => {
    const isForwardByOne =
      prevLayerIndex !== null &&
      layerIndex === prevLayerIndex + 1 &&
      layerIndex > 0;
    if (!isForwardByOne) return null;
    const justAppliedLayer = layers[layerIndex - 1];
    if (!justAppliedLayer) return null;

    const regionAdds: Array<{ slug: string }> = [];
    const skeinConnects: Array<{ from: string; to: string }> = [];
    const claimChanges: Array<{
      hexes: Array<[number, number]>;
      faction: string | null;
    }> = [];
    for (const change of justAppliedLayer.changes) {
      if (change.op === "add") regionAdds.push({ slug: change.slug });
      else if (change.op === "skein-connect")
        skeinConnects.push({ from: change.from, to: change.to });
      else if (change.op === "claim")
        claimChanges.push({ hexes: change.hexes, faction: change.faction });
    }

    // Only compute prev faction state if we actually have flips to animate —
    // saves the fold on the common no-claim layer.
    let factionFlips: FactionFlipAnim[] = [];
    if (claimChanges.length > 0) {
      const prevOverrides = foldFactionOverrides(
        layers.slice(0, layerIndex - 1),
      );
      const prevEffective = computeEffectiveAssignments(
        FACTION_HEXES,
        UNOWNED_BASE_HEXES,
        prevOverrides,
        factionSlugs,
      );
      const prevFactionIdxByHex = new Map<string, number | null>();
      prevEffective.perFaction.forEach((hexes, idx) => {
        for (const [q, r] of hexes) prevFactionIdxByHex.set(`${q},${r}`, idx);
      });
      for (const [q, r] of prevEffective.unowned) {
        prevFactionIdxByHex.set(`${q},${r}`, null);
      }
      factionFlips = claimChanges
        .filter((c) => c.hexes.length > 0)
        .map((c) => {
          const lookups: Array<readonly [string, number | null]> = c.hexes.map(
            ([q, r]) => {
              const key = `${q},${r}`;
              const idx = prevFactionIdxByHex.has(key)
                ? (prevFactionIdxByHex.get(key) ?? null)
                : null;
              return [key, idx] as const;
            },
          );
          return {
            originHex: c.hexes[0],
            hexes: c.hexes,
            prevFactionIdxByHex: lookups,
          };
        });
    }

    if (
      regionAdds.length === 0 &&
      skeinConnects.length === 0 &&
      factionFlips.length === 0
    ) {
      return null;
    }

    return {
      layerIndex,
      budgetMs: Math.round(dwellMs * 0.8),
      regionAdds,
      skeinConnects,
      factionFlips,
    };
  }, [layers, layerIndex, prevLayerIndex, factionSlugs, dwellMs]);

  return (
    <div className={styles.root}>
      <div className={styles.mapRow}>
        <div className={styles.frame} data-og-target="frame">
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
          <div className={styles.hoverLabel} aria-live="polite">
            {hoveredFaction ? `+ ${hoveredFaction.name.toUpperCase()} +` : ""}
          </div>
          <div className={styles.hoverSubtitle} aria-live="polite">
            {hoveredRegion
              ? `· ${hoveredRegion.name}`
              : hoveredSkein
                ? `· ${hoveredSkein.name}`
                : ""}
          </div>
          <ClientOnly>
            <HexMap
              factions={factions}
              regions={regions}
              skein={skein}
              factionHexes={effectiveFactionState.factionHexes}
              unownedHexes={effectiveFactionState.unownedHexes}
              factionBorders={effectiveFactionState.factionBorders}
              territoryBorders={effectiveFactionState.territoryBorders}
              hoveredFaction={hoveredFactionIdx}
              hoveredRegionSlug={hoveredRegionSlug}
              visibleOverlays={visibleOverlays}
              animation={animation}
              onFactionClick={handleFactionClick}
              onFactionHover={handleFactionHover}
              onRegionHover={handleRegionHover}
              onSkeinHover={handleSkeinHover}
            />
          </ClientOnly>
        </div>
        <OverlayStrip
          overlays={OVERLAYS}
          visible={visibleOverlays}
          onToggle={toggleOverlay}
        />
      </div>
      <TimelineStrip
        layers={layers}
        index={layerIndex}
        isPlaying={isPlaying}
        dwellMs={dwellMs}
        onIndexChange={setIndex}
      />
      <MemoriamPanel
        entries={fallenEntries}
        onFactionClick={handleFactionClick}
      />
      <Modal
        faction={selectedFaction}
        onClose={() => setSelectedFaction(null)}
      />
    </div>
  );
}
