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
    const guild = await this.client.guilds.fetch(this.guildId);
    this.connection = joinVoiceChannel({
      channelId,
      guildId: this.guildId,
      adapterCreator: guild.voiceAdapterCreator,
    });
    this.connection.subscribe(this.player);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.channelId = channelId;
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
