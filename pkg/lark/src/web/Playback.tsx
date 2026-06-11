import { type NowPlaying, usePlayback } from "./playbackState";

const LOOP_NEXT: Record<NowPlaying["loopMode"], NowPlaying["loopMode"]> = {
  none: "playlist",
  playlist: "track",
  track: "none",
};
const LOOP_LABEL: Record<NowPlaying["loopMode"], string> = { none: "Loop: off", playlist: "Loop: queue", track: "Loop: track" };

/** Now-playing bar with transport controls; reads shared state and hides if no bot. */
export function Playback() {
  const { np, unavailable, cmd } = usePlayback();

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
