/**
 * Shared now-playing state. One poller of `/api/v1/playback/now` feeds both the
 * transport bar and the per-row play/pause buttons, so they never disagree.
 * Commands update the state from their response for snappy feedback.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiGet, apiSend } from "./api";

export interface NowPlaying {
  connected: boolean;
  channelId: string | null;
  status: "idle" | "playing" | "paused";
  loopMode: "none" | "track" | "playlist";
  current: { trackId: number; title: string; positionMs: number; durationMs: number | null } | null;
  queueLength: number;
  queueIndex: number;
}

interface PlaybackApi {
  np: NowPlaying | null;
  unavailable: boolean;
  /** Fire a transport command (pause/resume/next/…); updates state, swallows errors. */
  cmd: (path: string, body?: unknown) => Promise<void>;
  /** Start playing tracks; updates state and rethrows so callers can surface failure. */
  playTracks: (trackIds: number[]) => Promise<void>;
}

const PlaybackCtx = createContext<PlaybackApi | null>(null);

export function usePlayback(): PlaybackApi {
  const ctx = useContext(PlaybackCtx);
  if (!ctx) throw new Error("usePlayback must be used within <PlaybackProvider>");
  return ctx;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [np, setNp] = useState<NowPlaying | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setNp(await apiGet<NowPlaying>("/api/v1/playback/now"));
      setUnavailable(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [refresh]);

  const cmd = useCallback(
    async (path: string, body?: unknown) => {
      try {
        setNp(await apiSend<NowPlaying>("POST", path, body));
      } catch {
        void refresh();
      }
    },
    [refresh],
  );

  const playTracks = useCallback(async (trackIds: number[]) => {
    if (trackIds.length === 0) return;
    setNp(await apiSend<NowPlaying>("POST", "/api/v1/playback/play", { trackIds }));
  }, []);

  return <PlaybackCtx.Provider value={{ np, unavailable, cmd, playTracks }}>{children}</PlaybackCtx.Provider>;
}
