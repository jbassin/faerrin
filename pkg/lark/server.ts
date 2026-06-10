/**
 * Production entrypoint (`bun run start`). Loads config from env, opens the DB
 * (running migrations), and serves the SPA + API on the configured port. Kept
 * thin — all logic lives in `src/server/app.ts` so it stays unit-testable.
 */
import { mkdirSync } from "node:fs";
import { loadConfig } from "./src/lib/appconfig";
import { openDb } from "./src/db/index";
import { startServer } from "./src/server/app";
import { ffmpegProber } from "./src/media/probe";
import { realYtDlp } from "./src/media/ytdlp";
import { IngestService } from "./src/server/ingest";
import { JobHub } from "./src/server/jobhub";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbPath);
const hub = new JobHub();
const ingest = new IngestService({ db, dataDir: config.dataDir, ytdlp: realYtDlp, hub, prober: ffmpegProber });
const { server } = startServer(config, db, { services: { prober: ffmpegProber, ingest, hub } });

console.log(`[lark] listening on http://localhost:${server.port}`);
console.log(`[lark] data dir: ${config.dataDir}`);
console.log(`[lark] allowlisted users: ${config.allowlist.size}`);
