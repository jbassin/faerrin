/**
 * Single-session playback engine (plan §6 Playback + B1/B2). One voice session
 * at a time (D3); all mutating commands are **serialized** through an internal
 * lock so web + Stream Deck can never desync the now-playing state (B9).
 *
 * Discord voice is injected (VoiceAdapter), so queue advancement, loop modes,
 * resilient skip-on-error, loudness gain, and the 60s auto-leave are all
 * unit-tested with a fake adapter and fake timers (CI-safe).
 */
import type { Database } from "bun:sqlite";
import * as repo from "../db/repo";
import { buildAudioFilter, computeGainDb } from "./gain";
import type { TrackEndReason, VoiceAdapter, VoiceStateResolver } from "./voice";

export type LoopMode = "none" | "track" | "playlist";
export type PlaybackStatus = "idle" | "playing" | "paused";

export interface NowPlaying {
  connected: boolean;
  channelId: string | null;
  status: PlaybackStatus;
  loopMode: LoopMode;
  current: { trackId: number; title: string; positionMs: number; durationMs: number | null } | null;
  queueLength: number;
  queueIndex: number;
}

export class PlaybackError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PlaybackDeps {
  db: Database;
  voice: VoiceAdapter;
  resolver: VoiceStateResolver;
  targetLufs: number;
  autoLeaveMs?: number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
}

export interface PlayRequest {
  trackIds: number[];
  /** Discord user to follow into a voice channel (D8). */
  userId?: string;
  /** Explicit channel override (D8). */
  channelId?: string;
}

export class PlaybackEngine {
  private queue: number[] = [];
  private index = 0;
  private loopMode: LoopMode = "none";
  private status: PlaybackStatus = "idle";
  private currentTitle = "";
  private currentDurationMs: number | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: PlaybackDeps) {}

  // --- serialization (B9) ---
  private run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.lock.then(() => fn());
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // --- channel resolution (B1/D8) ---
  private async resolveChannel(req: { userId?: string; channelId?: string }): Promise<string> {
    if (req.channelId) return req.channelId;
    if (req.userId) {
      const ch = await this.deps.resolver.channelOf(req.userId);
      if (ch) return ch;
    }
    throw new PlaybackError(409, "join a voice channel first");
  }

  join(req: { userId?: string; channelId?: string }): Promise<void> {
    return this.run(async () => {
      const channelId = await this.resolveChannel(req);
      await this.deps.voice.join(channelId);
    });
  }

  play(req: PlayRequest): Promise<NowPlaying> {
    return this.run(async () => {
      if (req.trackIds.length === 0) throw new PlaybackError(400, "no_tracks");
      if (!this.deps.voice.isConnected()) {
        await this.deps.voice.join(await this.resolveChannel(req));
      } else if (req.channelId && req.channelId !== this.deps.voice.currentChannelId()) {
        await this.deps.voice.join(req.channelId); // move (one session, D3)
      }
      this.queue = [...req.trackIds];
      this.index = 0;
      await this.startCurrent();
      return this.snapshot();
    });
  }

  stop(): Promise<NowPlaying> {
    // Stop = halt + clear queue, STAY connected (D6).
    return this.run(() => {
      this.deps.voice.stopAudio();
      this.queue = [];
      this.index = 0;
      this.status = "idle";
      this.currentTitle = "";
      this.currentDurationMs = null;
      return this.snapshot();
    });
  }

  pause(): Promise<NowPlaying> {
    return this.run(() => {
      if (this.status === "playing") {
        this.deps.voice.pause();
        this.status = "paused";
      }
      return this.snapshot();
    });
  }

  resume(): Promise<NowPlaying> {
    return this.run(() => {
      if (this.status === "paused") {
        this.deps.voice.resume();
        this.status = "playing";
      }
      return this.snapshot();
    });
  }

  next(): Promise<NowPlaying> {
    return this.run(async () => {
      await this.advance(1, false);
      return this.snapshot();
    });
  }

  prev(): Promise<NowPlaying> {
    return this.run(async () => {
      await this.advance(-1, false);
      return this.snapshot();
    });
  }

  setLoop(mode: LoopMode): Promise<NowPlaying> {
    return this.run(() => {
      this.loopMode = mode;
      return this.snapshot();
    });
  }

  leave(): Promise<NowPlaying> {
    return this.run(() => {
      this.cancelLeaveTimer();
      this.deps.voice.leave();
      this.queue = [];
      this.index = 0;
      this.status = "idle";
      return this.snapshot();
    });
  }

  /** Gateway tells us how many non-bot members remain; drives 60s auto-leave (B2). */
  notifyPopulation(nonBotCount: number): void {
    if (!this.deps.voice.isConnected()) return;
    if (nonBotCount <= 0) {
      if (this.leaveTimer) return;
      const setTimer = this.deps.setTimer ?? setTimeout;
      this.leaveTimer = setTimer(() => {
        this.leaveTimer = null;
        void this.leave();
      }, this.deps.autoLeaveMs ?? 60_000);
    } else {
      this.cancelLeaveTimer();
    }
  }

  private cancelLeaveTimer(): void {
    if (this.leaveTimer) {
      (this.deps.clearTimer ?? clearTimeout)(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  nowPlaying(): NowPlaying {
    return this.snapshot();
  }

  // --- internals ---

  private snapshot(): NowPlaying {
    const trackId = this.queue[this.index];
    return {
      connected: this.deps.voice.isConnected(),
      channelId: this.deps.voice.currentChannelId(),
      status: this.status,
      loopMode: this.loopMode,
      current:
        this.status !== "idle" && trackId !== undefined
          ? {
              trackId,
              title: this.currentTitle,
              positionMs: this.deps.voice.positionMs(),
              durationMs: this.currentDurationMs,
            }
          : null,
      queueLength: this.queue.length,
      queueIndex: this.index,
    };
  }

  /** Play the track at `this.index`, skipping broken tracks (B10). */
  private async startCurrent(skipBudget = this.queue.length + 1): Promise<void> {
    if (this.queue.length === 0 || skipBudget <= 0) {
      this.status = "idle";
      return;
    }
    const trackId = this.queue[this.index];
    if (trackId === undefined) {
      this.status = "idle";
      return;
    }
    const track = repo.getTrack(this.deps.db, trackId);
    if (!track || !track.file_path) {
      if (track) this.markTrackError(track.id); // file missing → mark + skip (B10)
      return this.skipBroken(skipBudget);
    }
    const filter = buildAudioFilter(computeGainDb(track.loudness_lufs, { targetLufs: this.deps.targetLufs }));
    try {
      await this.deps.voice.play(track.file_path, filter, (reason) => this.onEnd(reason));
      this.status = "playing";
      this.currentTitle = track.title;
      this.currentDurationMs = track.duration_ms;
    } catch {
      this.markTrackError(track.id);
      return this.skipBroken(skipBudget);
    }
  }

  private markTrackError(trackId: number): void {
    this.deps.db.run("UPDATE tracks SET status = 'error', updated_at = datetime('now') WHERE id = ?", [trackId]);
  }

  /** Move to the next track after a broken one, bounded by skipBudget. */
  private async skipBroken(skipBudget: number): Promise<void> {
    this.index++;
    if (this.index >= this.queue.length) {
      if (this.loopMode === "playlist") this.index = 0;
      else {
        this.status = "idle";
        return;
      }
    }
    await this.startCurrent(skipBudget - 1);
  }

  /** Manual or end-of-track advance by `delta` (`onEndAdvance` applies loop). */
  private async advance(delta: number, onEndAdvance: boolean): Promise<void> {
    if (this.queue.length === 0) return;
    if (onEndAdvance && this.loopMode === "track") {
      await this.startCurrent();
      return;
    }
    this.index += delta;
    if (this.index >= this.queue.length) {
      if (this.loopMode === "playlist") this.index = 0;
      else {
        this.index = this.queue.length - 1;
        if (onEndAdvance) {
          this.deps.voice.stopAudio();
          this.status = "idle";
          return;
        }
      }
    } else if (this.index < 0) {
      this.index = 0;
    }
    await this.startCurrent();
  }

  /** Called by the voice adapter when a track ends. */
  private onEnd(reason: TrackEndReason): void {
    if (reason === "stopped") return; // explicit stop/skip already handled
    void this.run(async () => {
      if (reason === "error") {
        const trackId = this.queue[this.index];
        if (trackId !== undefined) this.markTrackError(trackId);
        await this.skipBroken(this.queue.length + 1);
      } else {
        await this.advance(1, true);
      }
    });
  }
}
