/**
 * Real VoiceAdapter over @discordjs/voice (plan D1). Pipes the source file
 * through ffmpeg (prism-media) with the loudness/limiter `-af` filter into a Raw
 * Opus resource. Exercised live only (the Phase 0 spike proved the primitives);
 * never imported by unit tests.
 */
import {
  type AudioResource,
  type VoiceConnection,
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { Client } from "discord.js";
import prism from "prism-media";
import type { TrackEndReason, VoiceAdapter } from "./voice";

export class DiscordVoiceAdapter implements VoiceAdapter {
  private connection: VoiceConnection | null = null;
  private channelId: string | null = null;
  private resource: AudioResource | null = null;
  private endCb: ((reason: TrackEndReason) => void) | null = null;
  private suppressEnd = false;
  private readonly player = createAudioPlayer();

  constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {
    this.player.on(AudioPlayerStatus.Idle, () => this.fireEnd("finished"));
    this.player.on("error", () => this.fireEnd("error"));
  }

  private fireEnd(reason: TrackEndReason): void {
    const cb = this.endCb;
    this.endCb = null;
    this.resource = null;
    if (this.suppressEnd) {
      this.suppressEnd = false;
      return;
    }
    cb?.(reason);
  }

  async join(channelId: string): Promise<void> {
    // Use the gateway-cached guild — its voiceAdapterCreator is wired to the
    // live shard that receives VOICE_SERVER_UPDATE. A REST-fetched guild's
    // adapter can leave the connection stuck in Signalling.
    const guild = this.client.guilds.cache.get(this.guildId);
    if (!guild) throw new Error(`guild ${this.guildId} not in gateway cache — cannot acquire voice adapter`);

    console.log(`[lark] joining voice channel ${channelId}…`);
    const conn = joinVoiceChannel({ channelId, guildId: this.guildId, adapterCreator: guild.voiceAdapterCreator });
    if (conn !== this.connection) {
      conn.on("stateChange", (oldState, newState) =>
        console.log(`[lark] voice connection ${oldState.status} → ${newState.status}`),
      );
      conn.on("error", (err) => console.error("[lark] voice connection error:", err));
    }
    this.connection = conn;
    conn.subscribe(this.player);
    try {
      await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      console.error(
        "[lark] voice connection did not reach Ready within 20s — likely the Bun @discordjs/voice limitation (D1) " +
          "or missing Connect/Speak permission on the channel:",
        err,
      );
      conn.destroy();
      this.connection = null;
      this.channelId = null;
      throw new Error("voice_connect_timeout");
    }
    this.channelId = channelId;
    console.log(`[lark] voice connection READY in ${channelId}`);
  }

  leave(): void {
    this.suppressEnd = true;
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = null;
    this.channelId = null;
  }

  isConnected(): boolean {
    return this.connection !== null && this.channelId !== null;
  }

  currentChannelId(): string | null {
    return this.channelId;
  }

  async play(filePath: string, filter: string, onEnd: (reason: TrackEndReason) => void): Promise<void> {
    // Replacing any current resource: suppress the synthetic Idle from stopping it.
    if (this.resource) this.suppressEnd = true;
    const transcoder = new prism.FFmpeg({
      args: [
        "-analyzeduration",
        "0",
        "-loglevel",
        "0",
        "-i",
        filePath,
        ...(filter ? ["-af", filter] : []),
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
      ],
    });
    this.resource = createAudioResource(transcoder, { inputType: StreamType.Raw });
    this.endCb = onEnd;
    this.player.play(this.resource);
  }

  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.unpause();
  }

  stopAudio(): void {
    this.suppressEnd = true;
    this.player.stop(true);
  }

  positionMs(): number {
    return this.resource?.playbackDuration ?? 0;
  }
}
