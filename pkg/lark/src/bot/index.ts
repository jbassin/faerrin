/**
 * Discord bot bootstrap (plan §4/B1/B2). Builds the client, the follow-the-
 * operator resolver, the voice adapter, and the playback engine, and wires
 * voice-state changes to the 60s auto-leave. Started from server.ts only when a
 * token is configured. Not imported by unit tests.
 */
import type { Database } from "bun:sqlite";
import { Client, GatewayIntentBits } from "discord.js";
import { DiscordVoiceAdapter } from "./discord-voice";
import { PlaybackEngine } from "./playback";
import type { VoiceStateResolver } from "./voice";

export interface BotHandle {
  client: Client;
  engine: PlaybackEngine;
}

export async function startBot(opts: {
  token: string;
  guildId: string;
  db: Database;
  targetLufs: number;
}): Promise<BotHandle> {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const adapter = new DiscordVoiceAdapter(client, opts.guildId);

  const resolver: VoiceStateResolver = {
    channelOf(userId) {
      return client.guilds.cache.get(opts.guildId)?.voiceStates.cache.get(userId)?.channelId ?? null;
    },
  };

  const engine = new PlaybackEngine({ db: opts.db, voice: adapter, resolver, targetLufs: opts.targetLufs });

  // Auto-leave (B2): whenever voice state changes, recount non-bot members in
  // the bot's current channel and let the engine arm/cancel its 60s timer.
  client.on("voiceStateUpdate", () => {
    const channelId = adapter.currentChannelId();
    if (!channelId) return;
    const channel = client.guilds.cache.get(opts.guildId)?.channels.cache.get(channelId);
    if (channel?.isVoiceBased()) {
      engine.notifyPopulation(channel.members.filter((m) => !m.user.bot).size);
    }
  });

  await client.login(opts.token);
  return { client, engine };
}
