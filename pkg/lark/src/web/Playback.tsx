import { useCallback, useEffect, useState } from "react";
import { ApiError, apiGet, apiSend } from "./api";

interface NowPlaying {
  connected: boolean;
  channelId: string | null;
  status: "idle" | "playing" | "paused";
  loopMode: "none" | "track" | "playlist";
  current: { trackId: number; title: string; positionMs: number; durationMs: number | null } | null;
  queueLength: number;
  queueIndex: number;
}

const LOOP_NEXT: Record<NowPlaying["loopMode"], NowPlaying["loopMode"]> = {
  none: "playlist",
  playlist: "track",
  track: "none",
};
const LOOP_LABEL: Record<NowPlaying["loopMode"], string> = { none: "Loop: off", playlist: "Loop: queue", track: "Loop: track" };

/** Now-playing bar with transport controls; polls the engine and hides if no bot. */
export function Playback() {
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

  async function cmd(path: string, body?: unknown) {
    try {
      setNp(await apiSend<NowPlaying>("POST", path, body));
    } catch {
      void refresh();
    }
  }

  if (unavailable) return <div className="pb pb--off muted">Playback bot offline (no Discord token configured).</div>;
  if (!np) return null;

  return (
    <div className="pb">
      <div className="pb__info">
        {np.current ? (
          <>
            <strong>{np.current.title}</strong>
            <span className="muted">
              {" "}
              · {np.status} · {np.queueIndex + 1}/{np.queueLength}
            </span>
          </>
        ) : (
          <span className="muted">{np.connected ? "Connected · idle" : "Not in a voice channel"}</span>
        )}
      </div>
      <div className="pb__controls">
        <button className="btn btn--ghost" onClick={() => void cmd("/api/v1/playback/prev")}>
          ⏮
        </button>
        {np.status === "playing" ? (
          <button className="btn btn--ghost" onClick={() => void cmd("/api/v1/playback/pause")}>
            ⏸
          </button>
        ) : (
          <button className="btn btn--ghost" onClick={() => void cmd("/api/v1/playback/resume")}>
            ▶
          </button>
        )}
        <button className="btn btn--ghost" onClick={() => void cmd("/api/v1/playback/next")}>
          ⏭
        </button>
        <button className="btn btn--ghost" onClick={() => void cmd("/api/v1/playback/stop")}>
          ⏹
        </button>
        <button className="btn btn--ghost" onClick={() => void cmd("/api/v1/playback/loop", { mode: LOOP_NEXT[np.loopMode] })}>
          {LOOP_LABEL[np.loopMode]}
        </button>
      </div>
    </div>
  );
}
