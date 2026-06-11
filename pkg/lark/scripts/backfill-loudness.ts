/**
 * Backfill EBU R128 loudness for tracks that lack it (D5/B25) — e.g. ones
 * imported while LARK_MEASURE_LOUDNESS was off. Safe to run against the live DB
 * (WAL + busy_timeout); idempotent (re-measures only tracks that need it).
 *
 *   bun run scripts/backfill-loudness.ts
 *
 * "Needs measuring" = loudness is NULL **or** at the EBU floor sentinel (≤ -60
 * LUFS): ebur128 reports -70.0 for silence / below-threshold, which an earlier
 * buggy measurement wrote for long files. No real track measures that low, so
 * re-measuring the floor self-heals those stale values.
 *
 * Tune parallelism with LARK_INGEST_CONCURRENCY (default 4); each measure reads
 * the whole file but is memory-bounded (~40MB).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { runPool } from "../src/lib/pool";
import { measureLoudness } from "../src/media/probe";
import { type Track, setTrackLoudness } from "../src/db/repo";

const dataDir = process.env.LARK_DATA_DIR ?? resolve(import.meta.dir, "../data");
const dbPath = resolve(dataDir, "lark.sqlite");
const concurrency = Number(process.env.LARK_INGEST_CONCURRENCY) || 4;

const db = new Database(dbPath);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 15000");

const tracks = db
  .query<Track, []>(
    "SELECT * FROM tracks WHERE (loudness_lufs IS NULL OR loudness_lufs <= -60) AND file_path IS NOT NULL AND status = 'ready' ORDER BY id",
  )
  .all();

console.log(`[backfill] ${tracks.length} track(s) need loudness — missing or floored (concurrency=${concurrency})`);

let done = 0;
let failed = 0;
let processed = 0;
await runPool(tracks, concurrency, async (t) => {
  try {
    if (!t.file_path || !existsSync(t.file_path)) throw new Error("file missing");
    const lufs = await measureLoudness(t.file_path);
    if (lufs === undefined) throw new Error("no loudness parsed");
    setTrackLoudness(db, t.id, lufs);
    done++;
  } catch (err) {
    failed++;
    console.error(`[backfill] track ${t.id} "${t.title.slice(0, 40)}" failed: ${(err as Error).message}`);
  }
  if (++processed % 5 === 0 || processed === tracks.length) {
    console.log(`[backfill] ${processed}/${tracks.length} (measured=${done} failed=${failed})`);
  }
});

console.log(`[backfill] complete: measured ${done}, failed ${failed}`);
db.close();
