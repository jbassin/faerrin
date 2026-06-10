/**
 * Database open + migration runner (plan §5). Uses `bun:sqlite` (native to Bun,
 * precedent in mouth/aether scripts). Safe to call repeatedly: migrations are
 * idempotent via the `_migrations` ledger.
 */
import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema";

export type DB = Database;

/** Apply any not-yet-applied migrations, in version order, each in a txn. */
export function runMigrations(db: Database): number {
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const appliedRow = db.query<{ v: number | null }, []>("SELECT MAX(version) AS v FROM _migrations").get();
  const applied = appliedRow?.v ?? 0;
  let count = 0;
  for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (m.version <= applied) continue;
    db.transaction(() => {
      db.run(m.sql);
      db.run("INSERT INTO _migrations (version, name) VALUES (?, ?)", [m.version, m.name]);
    })();
    count++;
  }
  return count;
}

/**
 * Open the DB at `path` (":memory:" in tests), enable WAL + foreign keys, and
 * migrate. Foreign keys are OFF by default in SQLite — we need them ON for the
 * ON DELETE CASCADE / SET NULL behaviors the data model relies on.
 */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}
