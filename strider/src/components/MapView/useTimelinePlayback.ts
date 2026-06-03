import { useEffect, useRef, useState } from "react";
import { stepDwellMs } from "@/lib/timeline";

// Lets the map frame finish its fade-in (and the dynamically-mounted HexMap
// settle) before the layer auto-advance starts ticking.
export const INITIAL_PAUSE_MS = 1400;

interface Playback {
  layerIndex: number;
  prevLayerIndex: number | null;
  isPlaying: boolean;
  setIndex: (next: number) => void;
}

// One-shot auto-advance: ticks 0 → layerCount, then unlocks manual stepping.
// Each tick uses stepDwellMs(N-1) to accelerate playback line by line.
//
// When `seen` is true the timeline initializes at the end (all layers applied)
// and the timer never runs — used when the user has already watched the intro
// and is returning to the home page from a faction.
//
// The effect's cleanup cancels in-flight timers, so StrictMode's intentional
// dev double-mount restarts playback cleanly rather than blocking it.
export function useTimelinePlayback(
  layerCount: number,
  seen = false,
): Playback {
  const [layerIndex, setLayerIndex] = useState(() => (seen ? layerCount : 0));
  const [isPlaying, setIsPlaying] = useState(() => !seen && layerCount > 0);
  // Records the value layerIndex held before its most recent change. Animations
  // rely on this to detect forward-by-one transitions; multi-step jumps and
  // backward steps intentionally skip animations.
  const prevIndexRef = useRef<number | null>(null);
  const lastIndexRef = useRef<number>(layerIndex);
  if (lastIndexRef.current !== layerIndex) {
    prevIndexRef.current = lastIndexRef.current;
    lastIndexRef.current = layerIndex;
  }
  const prevLayerIndex = prevIndexRef.current;

  useEffect(() => {
    if (seen) return;
    if (layerCount === 0) return;
    setLayerIndex(0);
    setIsPlaying(true);

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = (next: number): void => {
      if (cancelled) return;
      setLayerIndex(next);
      if (next >= layerCount) {
        setIsPlaying(false);
        return;
      }
      timeoutId = setTimeout(() => tick(next + 1), stepDwellMs(next - 1));
    };

    timeoutId = setTimeout(() => tick(1), INITIAL_PAUSE_MS);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [layerCount, seen]);

  const setIndex = (next: number): void => {
    if (isPlaying) return;
    if (next < 0 || next > layerCount) return;
    setLayerIndex(next);
  };

  return { layerIndex, prevLayerIndex, isPlaying, setIndex };
}
