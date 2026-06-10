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

  /** Detect URL type and kick off ingest. Returns the job + a completion promise. */
  start(url: string): StartResult {
    return isPlaylistUrl(url) ? this.startPlaylist(url) : this.startSingle(url);
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

  private startSingle(url: string): StartResult {
    const { db } = this.deps;
    const job = repo.createDownloadJob(db, { type: "single", sourceUrl: url });
    const videoId = extractVideoId(url) ?? url;
    const item = repo.addJobItem(db, { jobId: job.id, videoId, title: videoId, position: 0 });
    repo.updateDownloadJob(db, job.id, { totalItems: 1, status: "running" });
    const done = this.runItems(job.id, [{ item, target: { url } }]);
    return { job: repo.getDownloadJob(db, job.id)!, done };
  }

  private startPlaylist(url: string): StartResult {
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
      const collection = repo.createCollection(db, {
        name: info.title,
        sourceType: "youtube_playlist",
        sourceUrl: url,
      });
      repo.updateDownloadJob(db, job.id, {
        title: info.title,
        collectionId: collection.id,
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
    let completed = 0;
    let failed = 0;

    await runPool(work, this.deps.concurrency ?? 3, async ({ item, target }) => {
      try {
        await this.processItem(jobId, item, target);
        completed++;
      } catch (err) {
        failed++;
        repo.updateJobItem(db, item.id, { status: "error", error: (err as Error).message });
      }
      repo.updateDownloadJob(db, jobId, { completedItems: completed });
      this.publish(jobId);
    });

    const total = work.length;
    const status = failed === 0 ? "done" : completed === 0 ? "error" : "partial";
    repo.updateDownloadJob(db, jobId, { status, completedItems: completed });
    this.publish(jobId);
    void total;
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
