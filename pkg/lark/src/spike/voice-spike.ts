/**
 * Phase 0 voice spike — de-risks D1 (the project's #1 risk).
 *
 * Proves that under **Bun** the @discordjs/voice stack can:
 *   1. connect to a Discord voice channel (gateway + UDP),
 *   2. negotiate encryption via the pure-JS `libsodium-wrappers`,
 *   3. encode Opus via the pure-JS `opusscript`,
 *   4. transcode an arbitrary input through `ffmpeg` (prism-media),
 * and produce audible audio — with NO native modules, so the CI bun lane and
 * the Dagger `oven/bun` container stay buildable (risk §11.2).
 *
 * This is the ONE step that needs human input: a real bot token and a person
 * sitting in the target voice channel to confirm they hear the tone. Run:
 *
 *   cd pkg/lark
 *   cp .env.example .env   # fill DISCORD_TOKEN, LARK_GUILD_ID, LARK_SPIKE_CHANNEL_ID
 *   bun run spike                 # plays a generated 440 Hz tone, then leaves
 *   bun run spike /path/to.ogg    # or play a specific local audio file
 *
 * GATE: if you hear clean audio, D1 is confirmed and Bun is the runtime. If
 * Bun cannot connect/encode, fall back to running just the bot under Node
 * (the server/UI stay on Bun) — see thoughts/lark/plans/0001 §11.1.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { optionalEnv, requireEnv } from "../lib/config";

const DATA_DIR = resolve(import.meta.dir, "../../data");

/** Generate a short sine tone with ffmpeg so the spike needs no committed asset. */
async function generateTone(): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  const out = resolve(DATA_DIR, "spike-tone.ogg");
  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:a", "libvorbis", out],
    { stdout: "ignore", stderr: "ignore" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg tone generation failed (exit ${code}) — is ffmpeg installed?`);
  return out;
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const guildId = requireEnv("LARK_GUILD_ID");
  const channelId = requireEnv("LARK_SPIKE_CHANNEL_ID");
  const fileArg = process.argv[2];
  const audioPath = fileArg ?? (await generateTone());
  console.log(`[spike] audio source: ${audioPath}`);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.once("clientReady", async () => {
    console.log(`[spike] logged in as ${client.user?.tag}`);
    try {
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new Error(`channel ${channelId} is not a voice channel`);
      }

      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });
      console.log("[spike] joining voice…");
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      console.log("[spike] voice connection READY — udp + encryption negotiated ✓");

      const player = createAudioPlayer();
      connection.subscribe(player);
      const resource = createAudioResource(audioPath, { inputType: StreamType.Arbitrary });
      player.play(resource);
      console.log("[spike] playing — you should now HEAR audio in the channel 🔊");

      await entersState(player, AudioPlayerStatus.Playing, 10_000);
      await entersState(player, AudioPlayerStatus.Idle, 5 * 60_000);
      console.log("[spike] playback finished — Opus encode + ffmpeg pipe worked ✓");

      connection.destroy();
      await client.destroy();
      console.log("[spike] left the channel. D1 CONFIRMED under Bun. ✅");
      process.exit(0);
    } catch (err) {
      console.error("[spike] FAILED:", err);
      console.error(
        "[spike] If this is a Bun-specific voice failure, fall back to running the bot under Node (see plan §11.1).",
      );
      await client.destroy().catch(() => {});
      process.exit(1);
    }
  });

  console.log(`[spike] connecting to Discord (guild ${guildId})…`);
  console.log(`[spike] target LUFS (informational): ${optionalEnv("LARK_TARGET_LUFS", "-16")}`);
  await client.login(token);
}

void main();
