/**
 * Voice abstraction (plan §11.1). The playback engine talks only to this
 * interface, so its queue/loop/gain/auto-leave logic is unit-tested with a fake
 * while the real implementation (src/bot/discord-voice.ts) wraps @discordjs/voice.
 *
 * `play()` takes a precomputed ffmpeg `-af` filter (the loudness gain + limiter);
 * the design keeps a single "what's playing" slot but is structured so a future
 * decode-ahead/crossfade stage can be added without changing callers (§12).
 */
export type TrackEndReason = "finished" | "error" | "stopped";

export interface VoiceAdapter {
  join(channelId: string): Promise<void>;
  leave(): void;
  isConnected(): boolean;
  currentChannelId(): string | null;
  /** Begin playing `filePath` through the ffmpeg `filter`; `onEnd` fires once. */
  play(filePath: string, filter: string, onEnd: (reason: TrackEndReason) => void): Promise<void>;
  pause(): void;
  resume(): void;
  /** Halt current audio without disconnecting. */
  stopAudio(): void;
  /** Best-effort position of the current resource, in ms. */
  positionMs(): number;
}

/** Resolves which voice channel a given Discord user is currently in (D8/B1). */
export interface VoiceStateResolver {
  /** May be sync (tests) or async (REST fallback when the gateway cache misses). */
  channelOf(userId: string): string | null | Promise<string | null>;
}
