import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db/index";
import * as repo from "../src/db/repo";

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
});

function mkTrack(title: string, collectionId: number | null = null) {
  return repo.createTrack(db, { title, sourceType: "upload", collectionId });
}

describe("collections", () => {
  test("create assigns a unique slug", () => {
    const a = repo.createCollection(db, { name: "Final Fantasy" });
    const b = repo.createCollection(db, { name: "Final Fantasy" });
    expect(a.slug).toBe("final-fantasy");
    expect(b.slug).toBe("final-fantasy-2");
  });
  test("delete sets member tracks' collection to null (B15)", () => {
    const c = repo.createCollection(db, { name: "Zelda" });
    const t = mkTrack("Theme", c.id);
    repo.deleteCollection(db, c.id);
    expect(repo.getTrack(db, t.id)!.collection_id).toBeNull();
  });
});

describe("tracks + filtering", () => {
  test("listTracks filters by collection, tag, and q", () => {
    const c = repo.createCollection(db, { name: "C" });
    const t1 = mkTrack("Calm Town", c.id);
    const t2 = mkTrack("Dungeon Crawl", null);
    const calm = repo.upsertTag(db, "calm");
    repo.addTagsToTracks(db, [t1.id], [calm.id]);

    expect(repo.listTracks(db, { collectionId: c.id }).map((t) => t.id)).toEqual([t1.id]);
    expect(repo.listTracks(db, { tagId: calm.id }).map((t) => t.id)).toEqual([t1.id]);
    expect(repo.listTracks(db, { q: "dungeon" }).map((t) => t.id)).toEqual([t2.id]);
    expect(repo.listTracks(db).length).toBe(2);
  });

  test("bulkUpdateTitles applies to exactly the given ids (B13)", () => {
    const t1 = mkTrack("a");
    const t2 = mkTrack("b");
    const n = repo.bulkUpdateTitles(db, [
      { id: t1.id, title: "A2" },
      { id: t2.id, title: "B2" },
    ]);
    expect(n).toBe(2);
    expect(repo.getTrack(db, t1.id)!.title).toBe("A2");
  });

  test("delete returns file path and cascades tags (B18)", () => {
    const t = repo.createTrack(db, { title: "x", sourceType: "upload", filePath: "/data/x.ogg" });
    const tag = repo.upsertTag(db, "calm");
    repo.addTagsToTracks(db, [t.id], [tag.id]);
    const removed = repo.deleteTrack(db, t.id);
    expect(removed?.filePath).toBe("/data/x.ogg");
    expect(repo.tagsForTrack(db, t.id).length).toBe(0);
  });

  test("findTrackByVideoId supports dedup", () => {
    repo.createTrack(db, { title: "yt", sourceType: "youtube", sourceVideoId: "abc123" });
    expect(repo.findTrackByVideoId(db, "abc123")).not.toBeNull();
    expect(repo.findTrackByVideoId(db, "nope")).toBeNull();
  });
});

describe("tags", () => {
  test("upsertTag normalizes and dedupes (B16)", () => {
    const a = repo.upsertTag(db, "Calm");
    const b = repo.upsertTag(db, "  calm ");
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("calm");
  });
  test("addTagsToTracks is idempotent (B14)", () => {
    const t = mkTrack("x");
    const tag = repo.upsertTag(db, "calm");
    expect(repo.addTagsToTracks(db, [t.id], [tag.id])).toBe(1);
    expect(repo.addTagsToTracks(db, [t.id], [tag.id])).toBe(0); // OR IGNORE
    expect(repo.tagsForTrack(db, t.id).length).toBe(1);
  });
  test("listTags reports track_count", () => {
    const t = mkTrack("x");
    const tag = repo.upsertTag(db, "calm");
    repo.addTagsToTracks(db, [t.id], [tag.id]);
    expect(repo.listTags(db).find((x) => x.name === "calm")!.track_count).toBe(1);
  });
});

describe("reconcileInterruptedJobs (restart recovery)", () => {
  test("marks running jobs partial/error and clears non-terminal items", () => {
    const job = repo.createDownloadJob(db, { type: "playlist", sourceUrl: "u" });
    repo.updateDownloadJob(db, job.id, { status: "running", totalItems: 3 });
    const a = repo.addJobItem(db, { jobId: job.id, videoId: "a", title: "a", position: 0 });
    const b = repo.addJobItem(db, { jobId: job.id, videoId: "b", title: "b", position: 1 });
    repo.addJobItem(db, { jobId: job.id, videoId: "c", title: "c", position: 2 });
    repo.updateJobItem(db, a.id, { status: "done" });
    repo.updateJobItem(db, b.id, { status: "downloading", progressPct: 40 });

    expect(repo.reconcileInterruptedJobs(db)).toBe(1);

    const reconciled = repo.getDownloadJob(db, job.id)!;
    expect(reconciled.status).toBe("partial"); // one item was done
    expect(reconciled.completed_items).toBe(1);
    const items = repo.listJobItems(db, job.id);
    expect(items.find((i) => i.video_id === "a")!.status).toBe("done"); // preserved
    expect(items.find((i) => i.video_id === "b")!.status).toBe("error"); // was downloading
    expect(items.find((i) => i.video_id === "c")!.status).toBe("error"); // was queued
  });

  test("a job with nothing done becomes error", () => {
    const job = repo.createDownloadJob(db, { type: "single", sourceUrl: "u" });
    repo.updateDownloadJob(db, job.id, { status: "running" });
    repo.addJobItem(db, { jobId: job.id, videoId: "x", title: "x", position: 0 });
    repo.reconcileInterruptedJobs(db);
    expect(repo.getDownloadJob(db, job.id)!.status).toBe("error");
  });

  test("does not touch already-finished jobs", () => {
    const job = repo.createDownloadJob(db, { type: "single", sourceUrl: "u" });
    repo.updateDownloadJob(db, job.id, { status: "done" });
    expect(repo.reconcileInterruptedJobs(db)).toBe(0);
    expect(repo.getDownloadJob(db, job.id)!.status).toBe("done");
  });
});

describe("playlists", () => {
  test("setPlaylistItems persists order; reorder replaces (B17)", () => {
    const p = repo.createPlaylist(db, "Combat");
    const t1 = mkTrack("a");
    const t2 = mkTrack("b");
    const t3 = mkTrack("c");
    repo.setPlaylistItems(db, p.id, [t3.id, t1.id, t2.id]);
    expect(repo.playlistTrackIds(db, p.id)).toEqual([t3.id, t1.id, t2.id]);
    repo.setPlaylistItems(db, p.id, [t1.id, t2.id]);
    expect(repo.playlistTrackIds(db, p.id)).toEqual([t1.id, t2.id]);
  });
  test("updatePlaylist sets loop + shuffle", () => {
    const p = repo.createPlaylist(db, "x");
    repo.updatePlaylist(db, p.id, { loopMode: "playlist", shuffle: true });
    const got = repo.getPlaylist(db, p.id)!;
    expect(got.loop_mode).toBe("playlist");
    expect(got.shuffle).toBe(1);
  });
});
