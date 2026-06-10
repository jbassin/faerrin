/**
 * In-process VoiceAdapter over @discordjs/voice (plan D1). Runs inside the Bun
 * server — Bun handles voice fine once Discord's DAVE/E2EE requirement is met
 * (@discordjs/voice ≥0.19 + @snazzah/davey); the earlier "Bun can't do voice"
 * conclusion was actually a 4017 DAVE close on the old 0.18. Pipes the source
 * through ffmpeg (prism-media) with the loudness/limiter filter into a Raw Opus
 * resource.
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
    this.player.on("error", (err) => {
      console.error("[lark] audio player error:", err?.message ?? err);
      this.fireEnd("error");
    });
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
    // Gateway-cached guild — its voiceAdapterCreator is wired to the live shard.
    const guild = this.client.guilds.cache.get(this.guildId);
    if (!guild) throw new Error(`guild ${this.guildId} not in gateway cache`);
    console.log(`[lark] joining voice channel ${channelId}…`);
    const conn = joinVoiceChannel({ channelId, guildId: this.guildId, adapterCreator: guild.voiceAdapterCreator });
    if (conn !== this.connection) {
      conn.on("stateChange", (o, n) => console.log(`[lark] voice connection ${o.status} → ${n.status}`));
      conn.on("error", (err) => console.error("[lark] voice connection error:", err?.message ?? err));
    }
    this.connection = conn;
    conn.subscribe(this.player);
    try {
      await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      conn.destroy();
      this.connection = null;
      this.channelId = null;
      throw new Error(`voice_connect_timeout: ${(err as Error).message}`);
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
    if (this.resource) this.suppressEnd = true; // replacing — no spurious end
    const args = ["-analyzeduration", "0", "-loglevel", "0", "-i", filePath];
    if (filter) args.push("-af", filter);
    args.push("-f", "s16le", "-ar", "48000", "-ac", "2");
    const transcoder = new prism.FFmpeg({ args });
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
