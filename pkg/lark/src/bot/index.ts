/**
 * Discord bot bootstrap (plan §4/B1/B2) — all in-process under Bun. Builds the
 * client, the follow-the-operator resolver, the in-process voice adapter, and
 * the playback engine, and wires voice-state changes to the 60s auto-leave.
 * Started from server.ts only when a token is configured. Not unit-tested.
 */
import dns from "node:dns";
import type { Database } from "bun:sqlite";
import { Client, GatewayIntentBits } from "discord.js";
import { DiscordVoiceAdapter } from "./discord-voice";
import { PlaybackEngine } from "./playback";
import type { VoiceStateResolver } from "./voice";

// This host's IPv6 is broken (ULA only, no default route); Discord voice
// (*.discord.media) advertises AAAA, so without this the voice WS dials an
// unreachable IPv6 address. Force IPv4 process-wide before any connection.
dns.setDefaultResultOrder("ipv4first");

export interface BotHandle {
  client: Client;
  engine: PlaybackEngine;
  stop: () => void;
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
      // Fast path: gateway voice-state cache.
      const cached = client.guilds.cache.get(opts.guildId)?.voiceStates.cache.get(userId)?.channelId ?? null;
      if (cached) return cached;
      // Cache miss → authoritative REST lookup (200=channel_id, 404=not in voice).
      try {
        const vs = (await client.rest.get(`/guilds/${opts.guildId}/voice-states/${userId}`)) as {
          channel_id?: string | null;
        };
        return vs?.channel_id ?? null;
      } catch (err) {
        if ((err as { status?: number }).status !== 404) {
          console.error(`[lark] voice-state lookup failed for ${userId}:`, (err as Error).message);
        }
        return null;
      }
    },
  };

  const engine = new PlaybackEngine({ db: opts.db, voice: adapter, resolver, targetLufs: opts.targetLufs });

  // Auto-leave (B2): recount non-bot members in the active channel on any voice
  // change and let the engine arm/cancel its 60s timer.
  client.on("voiceStateUpdate", () => {
    const channelId = adapter.currentChannelId();
    if (!channelId) return;
    const channel = client.guilds.cache.get(opts.guildId)?.channels.cache.get(channelId);
    if (channel?.isVoiceBased()) engine.notifyPopulation(channel.members.filter((m) => !m.user.bot).size);
  });

  const ready = new Promise<void>((resolve) => client.once("clientReady", () => resolve()));
  await client.login(opts.token);
  await ready;
  const guild = client.guilds.cache.get(opts.guildId);
  console.log(`[lark] bot ready as ${client.user?.tag} in "${guild?.name ?? opts.guildId}"`);

  return { client, engine, stop: () => void client.destroy() };
}
