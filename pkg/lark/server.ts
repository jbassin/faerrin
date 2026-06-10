/**
 * Production entrypoint (`bun run start`). Loads config from env, opens the DB
 * (running migrations), and serves the SPA + API on the configured port. Kept
 * thin — all logic lives in `src/server/app.ts` so it stays unit-testable.
 */
import { mkdirSync } from "node:fs";
import { loadConfig } from "./src/lib/appconfig";
import { openDb } from "./src/db/index";
import { reconcileInterruptedJobs } from "./src/db/repo";
import { startServer } from "./src/server/app";
import { ffmpegProber } from "./src/media/probe";
import { realYtDlp } from "./src/media/ytdlp";
import { IngestService } from "./src/server/ingest";
import { JobHub } from "./src/server/jobhub";
import { startBot } from "./src/bot/index";
import type { PlaybackEngine } from "./src/bot/playback";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbPath);

// Clear zombie download jobs left "running" by a previous crash/restart so the
// UI doesn't show a perpetual import. Re-importing is cheap (video-id dedup).
const orphaned = reconcileInterruptedJobs(db);
if (orphaned > 0) console.log(`[lark] reconciled ${orphaned} interrupted download job(s) from a prior restart`);

const hub = new JobHub();
// Throttle bulk ingest: each item can spawn yt-dlp + an ffmpeg loudness pass, so
// high concurrency × ffmpeg is what OOM-kills the service. Default 2, tunable;
// loudness measurement can be turned off entirely (LARK_MEASURE_LOUDNESS=0) if
// memory is tight (tracks then play at unity gain until measured).
const ingestConcurrency = Number(process.env.LARK_INGEST_CONCURRENCY) || 2;
const measureLoudness = process.env.LARK_MEASURE_LOUDNESS !== "0";
const ingest = new IngestService({
  db,
  dataDir: config.dataDir,
  ytdlp: realYtDlp,
  hub,
  prober: measureLoudness ? ffmpegProber : undefined,
  concurrency: ingestConcurrency,
});
console.log(`[lark] ingest concurrency=${ingestConcurrency} loudness=${measureLoudness ? "on" : "off"}`);

// The Discord bot (voice/playback) is optional: without a token the web UI +
// library + ingest still run, and playback routes return 503 (§11.1).
let playback: PlaybackEngine | undefined;
const token = process.env.DISCORD_TOKEN?.trim();
if (token && config.guildId) {
  try {
    const bot = await startBot({ token, guildId: config.guildId, db, targetLufs: config.targetLufs });
    playback = bot.engine;
    console.log("[lark] discord voice daemon online (Node subprocess)");
  } catch (err) {
    console.error("[lark] discord bot failed to start (playback disabled):", err);
  }
} else {
  console.log("[lark] no DISCORD_TOKEN/guild — playback disabled (web UI + library still run)");
}

const { server } = startServer(config, db, { services: { prober: ffmpegProber, ingest, hub, playback } });

console.log(`[lark] listening on http://localhost:${server.port}`);
console.log(`[lark] data dir: ${config.dataDir}`);
console.log(`[lark] allowlisted users: ${config.allowlist.size}`);
