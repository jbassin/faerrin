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
    async channelOf(userId) {
      // Fast path: the gateway voice-state cache (populated by GuildVoiceStates).
      const cached = client.guilds.cache.get(opts.guildId)?.voiceStates.cache.get(userId)?.channelId ?? null;
      if (cached) return cached;
      // Cache miss (timing / gateway gap / cold cache) → ask Discord directly.
      // GET /guilds/{guild}/voice-states/{user} is authoritative: 200 with a
      // channel_id if the user is in voice, 404 if they aren't.
      try {
        const vs = (await client.rest.get(`/guilds/${opts.guildId}/voice-states/${userId}`)) as {
          channel_id?: string | null;
        };
        return vs?.channel_id ?? null;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status !== 404) console.error(`[lark] voice-state lookup failed for user ${userId}:`, err);
        return null; // 404 = genuinely not in a voice channel
      }
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

  client.once("clientReady", () => {
    const guild = client.guilds.cache.get(opts.guildId);
    if (!guild) {
      console.error(`[lark] WARNING: guild ${opts.guildId} not found — is LARK_GUILD_ID correct and the bot invited?`);
    } else {
      console.log(`[lark] ready in "${guild.name}" — ${guild.voiceStates.cache.size} voice state(s) cached`);
    }
  });

  await client.login(opts.token);
  return { client, engine };
}
