import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import MapView from "@/components/MapView/MapView";
import { FACTIONS } from "@/generated/factions";
import { LAYERS } from "@/generated/layers";
import { parseOverlaysParam } from "@/lib/overlays";

interface HomeSearch {
  seen?: boolean;
  overlays?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const out: HomeSearch = {};
    if ("seen" in search) out.seen = true;
    if (typeof search.overlays === "string") out.overlays = search.overlays;
    return out;
  },
  component: HomePage,
});

// Stable across renders so MapView's animation memo (keyed on layers/factions
// identity) doesn't re-emit the last-step animation when search params change.
const FACTIONS_MUTABLE = [...FACTIONS];
const LAYERS_MUTABLE = [...LAYERS];

function HomePage() {
  const { seen, overlays } = Route.useSearch();
  const initialVisibleOverlays = useMemo(
    () => parseOverlaysParam(overlays),
    [overlays],
  );
  return (
    // pointer-events: none so .frame chrome can let hex clicks fall through
    // to the Pixi canvas mounted by PixiHost. Interactive children inside
    // MapView (OverlayStrip, TimelineStrip, Modal) re-enable events.
    <main style={{ pointerEvents: "none" }}>
      <MapView
        factions={FACTIONS_MUTABLE}
        layers={LAYERS_MUTABLE}
        seen={seen}
        initialVisibleOverlays={initialVisibleOverlays}
      />
    </main>
  );
}
