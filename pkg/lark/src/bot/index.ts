/**
 * Discord bot bootstrap (plan §4/§11.1). Bun can't do @discordjs/voice (D1),
 * so the gateway + voice run in a Node subprocess (the voice daemon) and the
 * Bun-side `SubprocessBot` proxies the engine's `VoiceAdapter`/resolver to it.
 * Started from server.ts only when a token is configured. Not unit-tested.
 */
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { PlaybackEngine } from "./playback";
import { SubprocessBot } from "./subprocess-voice";

export interface BotHandle {
  engine: PlaybackEngine;
  stop: () => void;
}

export async function startBot(opts: {
  token: string;
  guildId: string;
  db: Database;
  targetLufs: number;
}): Promise<BotHandle> {
  // The voice daemon runs under Node (Bun voice is broken). Find a node binary:
  // explicit override, else PATH, else "node". On the host PATH may not include
  // nvm — set LARK_NODE_BIN in .env if `node` isn't found.
  const nodeBin = process.env.LARK_NODE_BIN || Bun.which("node") || "node";
  const daemonPath = resolve(import.meta.dir, "voice-daemon.mjs");

  const bot = new SubprocessBot(nodeBin, daemonPath, {
    ...process.env,
    DISCORD_TOKEN: opts.token,
    LARK_GUILD_ID: opts.guildId,
  });

  const engine = new PlaybackEngine({ db: opts.db, voice: bot, resolver: bot.resolver, targetLufs: opts.targetLufs });
  bot.onPopulation = (nonBotCount) => engine.notifyPopulation(nonBotCount);

  // Wait (bounded) for the daemon's Discord login before declaring playback ready.
  await Promise.race([
    bot.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("voice daemon login timed out")), 30_000)),
  ]);

  return { engine, stop: () => bot.kill() };
}
