import { createSignal, onCleanup, onMount } from "solid-js";
import "../styles/player.css";

export interface PlayerProps {
  id: string;
  src: string;
  title: string;
  /** Optional subtitle for the OS lock-screen / Now Playing card (e.g. campaign name). */
  artist?: string;
  /** Build-time runtime estimate; replaced by the real duration once metadata loads. */
  runtimeMs: number;
}

function mmss(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

const SKIP = 15; // seconds

export default function Player(props: PlayerProps) {
  let audio!: HTMLAudioElement;
  let track!: HTMLDivElement;

  const posKey = `caster:pos:${props.id}`;
  const [playing, setPlaying] = createSignal(false);
  const [current, setCurrent] = createSignal(0);
  const [duration, setDuration] = createSignal(props.runtimeMs / 1000);
  const [ready, setReady] = createSignal(false);
  const [scrubbing, setScrubbing] = createSignal(false);

  const frac = () => {
    const d = duration();
    return d > 0 ? Math.min(1, current() / d) : 0;
  };

  const savePos = () => {
    try {
      localStorage.setItem(posKey, String(audio.currentTime));
    } catch {
      /* storage may be unavailable (private mode) — ignore */
    }
  };

  const seekToClientX = (clientX: number) => {
    const rect = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const d = duration();
    if (d > 0) {
      audio.currentTime = f * d;
      setCurrent(audio.currentTime);
    }
  };

  const onTrackPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    setScrubbing(true);
    track.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  };
  const onTrackPointerMove = (e: PointerEvent) => {
    if (scrubbing()) seekToClientX(e.clientX);
  };
  const onTrackPointerUp = (e: PointerEvent) => {
    if (!scrubbing()) return;
    setScrubbing(false);
    try {
      track.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    savePos();
  };

  const toggle = () => {
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  const skip = (delta: number) => {
    audio.currentTime = Math.min(duration(), Math.max(0, audio.currentTime + delta));
    setCurrent(audio.currentTime);
    savePos();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") skip(SKIP);
    else if (e.key === "ArrowLeft") skip(-SKIP);
  };

  // OS-level media session (iOS lock screen, Android, macOS Now Playing, headset
  // buttons). Registering it is what keeps a backgrounded <audio> element treated
  // as an ongoing media session — the difference between "usually keeps playing
  // when the phone locks" and reliably so, plus real lock-screen controls.
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;

  // Mirror our scrub/skip position onto the lock-screen scrubber. iOS rejects the
  // call unless duration is finite and position is within [0, duration].
  const syncPosition = () => {
    if (!ms?.setPositionState) return;
    const d = audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      ms.setPositionState({
        duration: d,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime), d),
      });
    } catch {
      /* some engines throw on out-of-range transient values — ignore */
    }
  };

  onMount(() => {
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      setReady(true);
      const saved = Number(localStorage.getItem(posKey));
      if (Number.isFinite(saved) && saved > 0 && saved < audio.duration - 1) {
        audio.currentTime = saved;
        setCurrent(saved);
      }
      syncPosition();
    };
    const onTime = () => {
      if (!scrubbing()) setCurrent(audio.currentTime);
      syncPosition();
    };
    const onPlay = () => {
      setPlaying(true);
      if (ms) ms.playbackState = "playing";
    };
    const onPause = () => {
      setPlaying(false);
      if (ms) ms.playbackState = "paused";
      savePos();
    };
    const onEnd = () => {
      setPlaying(false);
      if (ms) ms.playbackState = "none";
      try {
        localStorage.removeItem(posKey);
      } catch {
        /* ignore */
      }
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    window.addEventListener("beforeunload", savePos);

    if (ms) {
      ms.metadata = new MediaMetadata({
        title: props.title,
        artist: props.artist ?? "",
        album: "Caster",
        artwork: [{ src: "/favicon.svg", type: "image/svg+xml" }],
      });
      // setActionHandler throws on unsupported actions in some engines; guard each.
      const setAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        try {
          ms.setActionHandler(action, handler);
        } catch {
          /* action unsupported on this platform — ignore */
        }
      };
      setAction("play", () => void audio.play());
      setAction("pause", () => audio.pause());
      setAction("seekbackward", (d) => skip(-(d.seekOffset ?? SKIP)));
      setAction("seekforward", (d) => skip(d.seekOffset ?? SKIP));
      setAction("seekto", (d) => {
        if (d.seekTime == null) return;
        if (d.fastSeek && "fastSeek" in audio) audio.fastSeek(d.seekTime);
        else audio.currentTime = d.seekTime;
        setCurrent(audio.currentTime);
        syncPosition();
        savePos();
      });
    }

    onCleanup(() => {
      savePos();
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      window.removeEventListener("beforeunload", savePos);
      if (ms) {
        for (const a of [
          "play",
          "pause",
          "seekbackward",
          "seekforward",
          "seekto",
        ] as MediaSessionAction[]) {
          try {
            ms.setActionHandler(a, null);
          } catch {
            /* ignore */
          }
        }
        ms.metadata = null;
        ms.playbackState = "none";
      }
    });
  });

  return (
    <div class="player" role="group" aria-label={`Audio player: ${props.title}`}>
      <audio ref={audio} src={props.src} preload="metadata" />

      <button
        class="player__play"
        classList={{ "is-playing": playing() }}
        onClick={toggle}
        onKeyDown={onKey}
        aria-label={playing() ? "Pause" : "Play"}
        aria-pressed={playing()}
      >
        <span class="player__glyph" aria-hidden="true">
          {playing() ? (
            <span class="glyph-pause">
              <i></i>
              <i></i>
            </span>
          ) : (
            <span class="glyph-play"></span>
          )}
        </span>
      </button>

      <div class="player__body">
        <div class="player__row">
          <button class="player__skip" onClick={() => skip(-SKIP)} aria-label="Back 15 seconds">
            «15
          </button>
          <div
            ref={track}
            class="player__track"
            classList={{ "is-scrubbing": scrubbing(), "is-ready": ready() }}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            role="slider"
            tabindex="0"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration())}
            aria-valuenow={Math.round(current())}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") skip(SKIP);
              else if (e.key === "ArrowLeft") skip(-SKIP);
            }}
          >
            <div class="player__fill" style={{ width: `${frac() * 100}%` }}></div>
            <div class="player__knob" style={{ left: `${frac() * 100}%` }}></div>
          </div>
          <button class="player__skip" onClick={() => skip(SKIP)} aria-label="Forward 15 seconds">
            15»
          </button>
        </div>
        <div class="player__times label">
          <span>{mmss(current())}</span>
          <span class="player__total">{mmss(duration())}</span>
        </div>
      </div>
    </div>
  );
}
