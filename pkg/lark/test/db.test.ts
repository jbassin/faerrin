import { describe, expect, test } from "bun:test";
import { openDb, runMigrations } from "../src/db/index";

function memDb() {
  return openDb(":memory:");
}

describe("migrations", () => {
  test("creates all expected tables", () => {
    const db = memDb();
    const rows = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    for (const t of [
      "collections",
      "tracks",
      "tags",
      "track_tags",
      "playlists",
      "playlist_items",
      "download_jobs",
      "download_job_items",
      "api_keys",
    ]) {
      expect(rows).toContain(t);
    }
    db.close();
  });

  test("are idempotent (re-running applies nothing)", () => {
    const db = memDb();
    expect(runMigrations(db)).toBe(0); // already applied during openDb
    db.close();
  });

  test("enforces foreign keys (cascade delete of track_tags)", () => {
    const db = memDb();
    db.run("INSERT INTO tracks (id, title, original_title, source_type) VALUES (1, 't', 't', 'upload')");
    db.run("INSERT INTO tags (id, name) VALUES (1, 'calm')");
    db.run("INSERT INTO track_tags (track_id, tag_id) VALUES (1, 1)");
    db.run("DELETE FROM tracks WHERE id = 1");
    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM track_tags").get();
    expect(count?.c).toBe(0); // cascaded
    db.close();
  });

  test("rejects bad check-constraint values", () => {
    const db = memDb();
    expect(() =>
      db.run("INSERT INTO tracks (title, original_title, source_type) VALUES ('t','t','bogus')"),
    ).toThrow();
    db.close();
  });
});
