import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db/index";
import * as repo from "../src/db/repo";
import { IngestService } from "../src/server/ingest";
import { JobHub } from "../src/server/jobhub";
import { isPlaylistUrl, extractVideoId } from "../src/media/ytdlp";
import type { YtDlp } from "../src/media/ytdlp";

describe("url classification", () => {
  test("isPlaylistUrl", () => {
    expect(isPlaylistUrl("https://youtube.com/watch?v=abc&list=PL123")).toBe(true);
    expect(isPlaylistUrl("https://youtube.com/watch?v=abc")).toBe(false);
    expect(isPlaylistUrl("https://youtube.com/watch?v=abc&list=RD123")).toBe(false); // radio mix
  });
  test("extractVideoId", () => {
    expect(extractVideoId("https://youtube.com/watch?v=abc123")).toBe("abc123");
    expect(extractVideoId("https://youtu.be/xyz789")).toBe("xyz789");
  });
});

let db: Database;
let dataDir: string;
let hub: JobHub;

/** A stub yt-dlp that "downloads" by writing a tiny file; can be told to fail ids. */
function stubYtDlp(opts: { entries?: { videoId: string; title: string }[]; failIds?: Set<string> } = {}): YtDlp {
  return {
    async enumerate() {
      return { title: "Chrono Trigger OST", entries: opts.entries ?? [] };
    },
    async download(target, destDir, onProgress) {
      const videoId = target.videoId ?? extractVideoId(target.url ?? "") ?? "single";
      if (opts.failIds?.has(videoId)) throw new Error("download blew up");
      onProgress?.(50);
      const filePath = join(destDir, `${videoId}.webm`);
      writeFileSync(filePath, "fake-audio");
      onProgress?.(100);
      return { filePath, title: `Title ${videoId}`, videoId, format: "webm", durationMs: 1000 };
    },
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  dataDir = mkdtempSync(join(tmpdir(), "lark-ingest-"));
  hub = new JobHub();
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function service(ytdlp: YtDlp) {
  return new IngestService({ db, dataDir, ytdlp, hub, prober: async () => ({ loudnessLufs: -20 }), concurrency: 2 });
}

describe("single ingest (B20)", () => {
  test("downloads one video → one ready track with loudness", async () => {
    const { job, done } = service(stubYtDlp()).start("https://youtu.be/song1");
    expect(job.type).toBe("single");
    await done;
    const finished = repo.getDownloadJob(db, job.id)!;
    expect(finished.status).toBe("done");
    const tracks = repo.listTracks(db);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.source_type).toBe("youtube");
    expect(tracks[0]!.loudness_lufs).toBe(-20);
  });
});

describe("playlist ingest (B21)", () => {
  test("creates a collection and a track per entry", async () => {
    const entries = [
      { videoId: "a", title: "A" },
      { videoId: "b", title: "B" },
      { videoId: "c", title: "C" },
    ];
    const { job, done } = service(stubYtDlp({ entries })).start("https://youtube.com/playlist?list=PL1");
    expect(job.type).toBe("playlist");
    await done;
    const finished = repo.getDownloadJob(db, job.id)!;
    expect(finished.status).toBe("done");
    expect(finished.total_items).toBe(3);
    expect(finished.completed_items).toBe(3);
    const collection = repo.listCollections(db).find((c) => c.id === finished.collection_id)!;
    expect(collection.name).toBe("Chrono Trigger OST");
    expect(repo.listTracks(db, { collectionId: collection.id })).toHaveLength(3);
  });

  test("one failing item → partial job, others still imported (B21)", async () => {
    const entries = [
      { videoId: "ok1", title: "ok1" },
      { videoId: "bad", title: "bad" },
      { videoId: "ok2", title: "ok2" },
    ];
    const { job, done } = service(stubYtDlp({ entries, failIds: new Set(["bad"]) })).start(
      "https://youtube.com/playlist?list=PL1",
    );
    await done;
    const finished = repo.getDownloadJob(db, job.id)!;
    expect(finished.status).toBe("partial");
    expect(repo.listTracks(db)).toHaveLength(2);
    const items = repo.listJobItems(db, job.id);
    expect(items.find((i) => i.video_id === "bad")!.status).toBe("error");
  });
});

describe("dedup (B23)", () => {
  test("re-importing an existing video links instead of duplicating", async () => {
    repo.createTrack(db, { title: "old", sourceType: "youtube", sourceVideoId: "dupe" });
    const { job, done } = service(stubYtDlp()).start("https://youtu.be/dupe");
    await done;
    expect(repo.listTracks(db)).toHaveLength(1); // no new track
    const item = repo.listJobItems(db, job.id)[0]!;
    expect(item.status).toBe("done");
    expect(item.error).toBe("duplicate");
  });
});

describe("sse hub", () => {
  test("publishes progress frames to subscribers", async () => {
    const frames: string[] = [];
    const { job, done } = service(stubYtDlp({ entries: [{ videoId: "a", title: "A" }] })).start(
      "https://youtube.com/playlist?list=PL1",
    );
    const off = hub.subscribe(job.id, (f) => frames.push(f));
    await done;
    off();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.includes('"status":"done"'))).toBe(true);
  });
});
