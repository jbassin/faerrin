/**
 * Ingest orchestration (plan B20–B25). Detects single vs playlist, builds the
 * download-job + items, runs downloads through a bounded pool, dedups by video
 * id, measures R128 loudness, creates tracks, and streams progress via the hub.
 *
 * yt-dlp + prober are injected, so the whole lifecycle is unit-tested with
 * stubs and no binaries (CI-safe). `start()` returns a `done` promise tests await.
 */
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { runPool } from "../lib/pool";
import type { AudioProbe, AudioProber } from "../media/probe";
import { type YtDlp, extractVideoId, isPlaylistUrl } from "../media/ytdlp";
import * as repo from "../db/repo";
import type { JobHub } from "./jobhub";

export interface IngestDeps {
  db: Database;
  dataDir: string;
  ytdlp: YtDlp;
  hub: JobHub;
  prober?: AudioProber;
  concurrency?: number;
}

export interface StartResult {
  job: repo.DownloadJob;
  done: Promise<void>;
}

export class IngestService {
  constructor(private readonly deps: IngestDeps) {}

  /**
   * Detect URL type and kick off ingest. If `collectionId` is given, tracks land
   * in that collection (a playlist won't create its own). Returns the job + a
   * completion promise.
   */
  start(url: string, collectionId?: number): StartResult {
    return isPlaylistUrl(url) ? this.startPlaylist(url, collectionId) : this.startSingle(url, collectionId);
  }

  private audioDir(): string {
    return resolve(this.deps.dataDir, "audio");
  }

  private publish(jobId: number): void {
    this.deps.hub.publish(jobId, {
      job: repo.getDownloadJob(this.deps.db, jobId),
      items: repo.listJobItems(this.deps.db, jobId),
    });
  }

  private startSingle(url: string, collectionId?: number): StartResult {
    const { db } = this.deps;
    const job = repo.createDownloadJob(db, { type: "single", sourceUrl: url, collectionId: collectionId ?? null });
    const videoId = extractVideoId(url) ?? url;
    const item = repo.addJobItem(db, { jobId: job.id, videoId, title: videoId, position: 0 });
    repo.updateDownloadJob(db, job.id, { totalItems: 1, status: "running" });
    const done = this.runItems(job.id, [{ item, target: { url } }]);
    return { job: repo.getDownloadJob(db, job.id)!, done };
  }

  private startPlaylist(url: string, collectionId?: number): StartResult {
    const { db } = this.deps;
    const job = repo.createDownloadJob(db, { type: "playlist", sourceUrl: url });
    const done = (async () => {
      let info;
      try {
        info = await this.deps.ytdlp.enumerate(url);
      } catch (err) {
        repo.updateDownloadJob(db, job.id, { status: "error", error: (err as Error).message });
        this.publish(job.id);
        return;
      }
      // Target an existing collection if given, else create one from the playlist.
      const targetId =
        collectionId ??
        repo.createCollection(db, { name: info.title, sourceType: "youtube_playlist", sourceUrl: url }).id;
      repo.updateDownloadJob(db, job.id, {
        title: info.title,
        collectionId: targetId,
        totalItems: info.entries.length,
        status: "running",
      });
      const work = info.entries.map((entry, i) => ({
        item: repo.addJobItem(db, { jobId: job.id, videoId: entry.videoId, title: entry.title, position: i }),
        target: { videoId: entry.videoId },
      }));
      this.publish(job.id);
      await this.runItems(job.id, work);
    })();
    return { job: repo.getDownloadJob(db, job.id)!, done };
  }

  private async runItems(
    jobId: number,
    work: { item: repo.DownloadJobItem; target: { url?: string; videoId?: string } }[],
  ): Promise<void> {
    const { db } = this.deps;
    await mkdir(this.audioDir(), { recursive: true }).catch(() => {});
    const doneCount = () => repo.listJobItems(db, jobId).filter((i) => i.status === "done").length;

    await runPool(work, this.deps.concurrency ?? 3, async ({ item, target }) => {
      try {
        await this.processItem(jobId, item, target);
      } catch (err) {
        repo.updateJobItem(db, item.id, { status: "error", error: (err as Error).message });
      }
      repo.updateDownloadJob(db, jobId, { completedItems: doneCount() });
      this.publish(jobId);
    });

    // Compute final status from the DB so it's correct for resumed jobs too.
    const items = repo.listJobItems(db, jobId);
    const done = items.filter((i) => i.status === "done").length;
    const failed = items.filter((i) => i.status === "error").length;
    repo.updateDownloadJob(db, jobId, {
      status: failed === 0 ? "done" : done === 0 ? "error" : "partial",
      completedItems: done,
    });
    this.publish(jobId);
  }

  /**
   * Resume jobs left mid-flight by a crash/restart (status still queued/running):
   * re-queue their non-done items and download them. Dedup makes already-finished
   * items instant. Returns the number of jobs resumed.
   */
  resumeInterrupted(): number {
    const { db } = this.deps;
    const jobs = db
      .query<repo.DownloadJob, []>("SELECT * FROM download_jobs WHERE status IN ('queued','running') ORDER BY id")
      .all();
    for (const job of jobs) {
      const pending = repo.listJobItems(db, job.id).filter((i) => i.status !== "done");
      if (pending.length === 0) {
        repo.updateDownloadJob(db, job.id, { status: "done" });
        continue;
      }
      repo.updateDownloadJob(db, job.id, { status: "running" });
      for (const it of pending) repo.updateJobItem(db, it.id, { status: "queued", progressPct: 0, error: null });
      const work = pending.map((item) => ({
        item,
        target: job.type === "single" ? { url: job.source_url } : { videoId: item.video_id },
      }));
      void this.runItems(job.id, work).catch((err) => console.error(`[lark] resume of job ${job.id} failed`, err));
    }
    return jobs.length;
  }

  private async processItem(
    jobId: number,
    item: repo.DownloadJobItem,
    target: { url?: string; videoId?: string },
  ): Promise<void> {
    const { db } = this.deps;
    const job = repo.getDownloadJob(db, jobId)!;
    repo.updateJobItem(db, item.id, { status: "downloading", progressPct: 0 });
    this.publish(jobId);

    // Dedup (B23): if this video already has a ready track, link to it and skip.
    if (item.video_id) {
      const existing = repo.findTrackByVideoId(db, item.video_id);
      if (existing) {
        repo.updateJobItem(db, item.id, { status: "done", progressPct: 100, trackId: existing.id, error: "duplicate" });
        return;
      }
    }

    let lastPct = 0;
    const result = await this.deps.ytdlp.download(target, this.audioDir(), (pct) => {
      if (pct - lastPct >= 5 || pct >= 100) {
        lastPct = pct;
        repo.updateJobItem(db, item.id, { progressPct: pct });
        this.publish(jobId);
      }
    });

    // Loudness on ingest (B25), best-effort.
    let loudnessLufs: number | null = null;
    let fileSize: number | null = null;
    if (this.deps.prober) {
      const probe: AudioProbe = await this.deps.prober(result.filePath).catch((): AudioProbe => ({}));
      loudnessLufs = probe.loudnessLufs ?? null;
    }
    fileSize = await stat(result.filePath)
      .then((s) => s.size)
      .catch(() => null);

    const track = repo.createTrack(db, {
      collectionId: job.collection_id,
      title: result.title,
      originalTitle: result.title,
      sourceType: "youtube",
      sourceUrl: target.url ?? `https://www.youtube.com/watch?v=${result.videoId}`,
      sourceVideoId: result.videoId,
      filePath: result.filePath,
      format: result.format,
      durationMs: result.durationMs ?? null,
      fileSize,
      loudnessLufs,
      status: "ready",
    });
    repo.updateJobItem(db, item.id, { status: "done", progressPct: 100, trackId: track.id });
  }
}
