/**
 * Typed repository functions over bun:sqlite (plan §5/§6). Thin, explicit SQL —
 * no ORM. Every function is unit-testable against an in-memory DB.
 */
import type { Database } from "bun:sqlite";
import { normalizeTag, slugify, uniqueSlug } from "../lib/text";

export interface Collection {
  id: number;
  name: string;
  slug: string;
  ip_or_game: string | null;
  source_type: "manual" | "youtube_playlist";
  source_url: string | null;
  cover_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Track {
  id: number;
  collection_id: number | null;
  title: string;
  original_title: string;
  source_type: "upload" | "youtube";
  source_url: string | null;
  source_video_id: string | null;
  file_path: string | null;
  format: string | null;
  duration_ms: number | null;
  file_size: number | null;
  loudness_lufs: number | null;
  status: "ready" | "downloading" | "error";
  error: string | null;
  added_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  category: string | null;
  created_at: string;
}

export interface Playlist {
  id: number;
  name: string;
  loop_mode: "none" | "track" | "playlist";
  shuffle: number;
  created_at: string;
  updated_at: string;
}

// --- Collections ---

export function createCollection(
  db: Database,
  input: {
    name: string;
    ipOrGame?: string | null;
    sourceType?: "manual" | "youtube_playlist";
    sourceUrl?: string | null;
  },
): Collection {
  const slug = uniqueSlug(slugify(input.name), (s) =>
    db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM collections WHERE slug = ?").get(s)!.n > 0,
  );
  const { lastInsertRowid } = db.run(
    "INSERT INTO collections (name, slug, ip_or_game, source_type, source_url) VALUES (?, ?, ?, ?, ?)",
    [input.name, slug, input.ipOrGame ?? null, input.sourceType ?? "manual", input.sourceUrl ?? null],
  );
  return getCollection(db, Number(lastInsertRowid))!;
}

export function getCollection(db: Database, id: number): Collection | null {
  return db.query<Collection, [number]>("SELECT * FROM collections WHERE id = ?").get(id) ?? null;
}

export function listCollections(db: Database): Collection[] {
  return db.query<Collection, []>("SELECT * FROM collections ORDER BY name COLLATE NOCASE").all();
}

export function renameCollection(db: Database, id: number, name: string): boolean {
  return db.run("UPDATE collections SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, id]).changes > 0;
}

export function deleteCollection(db: Database, id: number): boolean {
  // Tracks' collection_id is ON DELETE SET NULL — tracks/files survive (B15).
  return db.run("DELETE FROM collections WHERE id = ?", [id]).changes > 0;
}

// --- Tracks ---

export interface NewTrack {
  collectionId?: number | null;
  title: string;
  originalTitle?: string;
  sourceType: "upload" | "youtube";
  sourceUrl?: string | null;
  sourceVideoId?: string | null;
  filePath?: string | null;
  format?: string | null;
  durationMs?: number | null;
  fileSize?: number | null;
  loudnessLufs?: number | null;
  status?: "ready" | "downloading" | "error";
}

export function createTrack(db: Database, t: NewTrack): Track {
  const { lastInsertRowid } = db.run(
    `INSERT INTO tracks
       (collection_id, title, original_title, source_type, source_url, source_video_id,
        file_path, format, duration_ms, file_size, loudness_lufs, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.collectionId ?? null,
      t.title,
      t.originalTitle ?? t.title,
      t.sourceType,
      t.sourceUrl ?? null,
      t.sourceVideoId ?? null,
      t.filePath ?? null,
      t.format ?? null,
      t.durationMs ?? null,
      t.fileSize ?? null,
      t.loudnessLufs ?? null,
      t.status ?? "ready",
    ],
  );
  return getTrack(db, Number(lastInsertRowid))!;
}

export function getTrack(db: Database, id: number): Track | null {
  return db.query<Track, [number]>("SELECT * FROM tracks WHERE id = ?").get(id) ?? null;
}

export function findTrackByVideoId(db: Database, videoId: string): Track | null {
  return db.query<Track, [string]>("SELECT * FROM tracks WHERE source_video_id = ? LIMIT 1").get(videoId) ?? null;
}

export interface TrackFilter {
  collectionId?: number;
  tagId?: number;
  q?: string;
  limit?: number;
  offset?: number;
}

export function listTracks(db: Database, f: TrackFilter = {}): Track[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  let from = "tracks t";
  if (f.tagId !== undefined) {
    from += " JOIN track_tags tt ON tt.track_id = t.id AND tt.tag_id = ?";
    params.push(f.tagId);
  }
  if (f.collectionId !== undefined) {
    where.push("t.collection_id = ?");
    params.push(f.collectionId);
  }
  if (f.q) {
    where.push("t.title LIKE ?");
    params.push(`%${f.q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  return db
    .query<Track, (string | number)[]>(
      `SELECT t.* FROM ${from} ${whereSql} ORDER BY t.title COLLATE NOCASE LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
}

export function updateTrackTitle(db: Database, id: number, title: string): boolean {
  return db.run("UPDATE tracks SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id]).changes > 0;
}

/** Apply a map of {id → new title} in one transaction (bulk rename commit, B13). */
export function bulkUpdateTitles(db: Database, updates: { id: number; title: string }[]): number {
  let n = 0;
  db.transaction(() => {
    for (const u of updates) n += updateTrackTitle(db, u.id, u.title) ? 1 : 0;
  })();
  return n;
}

export function setTrackCollection(db: Database, id: number, collectionId: number | null): boolean {
  return db.run("UPDATE tracks SET collection_id = ?, updated_at = datetime('now') WHERE id = ?", [collectionId, id])
    .changes > 0;
}

export function setTrackLoudness(db: Database, id: number, lufs: number): boolean {
  return db.run("UPDATE tracks SET loudness_lufs = ?, updated_at = datetime('now') WHERE id = ?", [lufs, id]).changes > 0;
}

/** Delete a track row; returns its file_path so the caller can unlink the file (B18). */
export function deleteTrack(db: Database, id: number): { filePath: string | null } | null {
  const track = getTrack(db, id);
  if (!track) return null;
  db.run("DELETE FROM tracks WHERE id = ?", [id]); // track_tags cascade
  return { filePath: track.file_path };
}

// --- Tags ---

export function upsertTag(db: Database, name: string, category?: string | null): Tag {
  const norm = normalizeTag(name);
  const existing = db.query<Tag, [string]>("SELECT * FROM tags WHERE name = ?").get(norm);
  if (existing) return existing;
  const { lastInsertRowid } = db.run("INSERT INTO tags (name, category) VALUES (?, ?)", [norm, category ?? null]);
  return db.query<Tag, [number]>("SELECT * FROM tags WHERE id = ?").get(Number(lastInsertRowid))!;
}

export function listTags(db: Database): (Tag & { track_count: number })[] {
  return db
    .query<Tag & { track_count: number }, []>(
      `SELECT tags.*, COUNT(track_tags.track_id) AS track_count
       FROM tags LEFT JOIN track_tags ON track_tags.tag_id = tags.id
       GROUP BY tags.id ORDER BY tags.name`,
    )
    .all();
}

export function tagsForTrack(db: Database, trackId: number): Tag[] {
  return db
    .query<Tag, [number]>(
      "SELECT tags.* FROM tags JOIN track_tags tt ON tt.tag_id = tags.id WHERE tt.track_id = ? ORDER BY tags.name",
    )
    .all(trackId);
}

/** Add tags (by id) to many tracks; idempotent. Returns rows inserted. */
export function addTagsToTracks(db: Database, trackIds: number[], tagIds: number[]): number {
  let n = 0;
  db.transaction(() => {
    for (const trackId of trackIds)
      for (const tagId of tagIds)
        n += db.run("INSERT OR IGNORE INTO track_tags (track_id, tag_id) VALUES (?, ?)", [trackId, tagId]).changes;
  })();
  return n;
}

export function removeTagsFromTracks(db: Database, trackIds: number[], tagIds: number[]): number {
  let n = 0;
  db.transaction(() => {
    for (const trackId of trackIds)
      for (const tagId of tagIds)
        n += db.run("DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?", [trackId, tagId]).changes;
  })();
  return n;
}

export function deleteTag(db: Database, id: number): boolean {
  return db.run("DELETE FROM tags WHERE id = ?", [id]).changes > 0;
}

// --- Playlists ---

export function createPlaylist(db: Database, name: string): Playlist {
  const { lastInsertRowid } = db.run("INSERT INTO playlists (name) VALUES (?)", [name]);
  return getPlaylist(db, Number(lastInsertRowid))!;
}

export function getPlaylist(db: Database, id: number): Playlist | null {
  return db.query<Playlist, [number]>("SELECT * FROM playlists WHERE id = ?").get(id) ?? null;
}

export function listPlaylists(db: Database): Playlist[] {
  return db.query<Playlist, []>("SELECT * FROM playlists ORDER BY name COLLATE NOCASE").all();
}

export function updatePlaylist(
  db: Database,
  id: number,
  patch: { name?: string; loopMode?: "none" | "track" | "playlist"; shuffle?: boolean },
): boolean {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) (sets.push("name = ?"), params.push(patch.name));
  if (patch.loopMode !== undefined) (sets.push("loop_mode = ?"), params.push(patch.loopMode));
  if (patch.shuffle !== undefined) (sets.push("shuffle = ?"), params.push(patch.shuffle ? 1 : 0));
  if (!sets.length) return false;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.run(`UPDATE playlists SET ${sets.join(", ")} WHERE id = ?`, params).changes > 0;
}

export function deletePlaylist(db: Database, id: number): boolean {
  return db.run("DELETE FROM playlists WHERE id = ?", [id]).changes > 0;
}

/** Replace a playlist's ordered items (reorder/add/remove in one shot, B17). */
export function setPlaylistItems(db: Database, playlistId: number, trackIds: number[]): void {
  db.transaction(() => {
    db.run("DELETE FROM playlist_items WHERE playlist_id = ?", [playlistId]);
    trackIds.forEach((trackId, i) =>
      db.run("INSERT INTO playlist_items (playlist_id, track_id, position) VALUES (?, ?, ?)", [playlistId, trackId, i]),
    );
    db.run("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", [playlistId]);
  })();
}

export function playlistTrackIds(db: Database, playlistId: number): number[] {
  return db
    .query<{ track_id: number }, [number]>(
      "SELECT track_id FROM playlist_items WHERE playlist_id = ? ORDER BY position",
    )
    .all(playlistId)
    .map((r) => r.track_id);
}

// --- Download jobs (ingest, B21–B24) ---

export interface DownloadJob {
  id: number;
  type: "single" | "playlist";
  source_url: string;
  title: string | null;
  collection_id: number | null;
  status: "queued" | "running" | "done" | "error" | "partial";
  total_items: number;
  completed_items: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DownloadJobItem {
  id: number;
  job_id: number;
  video_id: string;
  title: string;
  position: number;
  status: "queued" | "downloading" | "done" | "error";
  progress_pct: number;
  error: string | null;
  track_id: number | null;
}

export function createDownloadJob(
  db: Database,
  input: { type: "single" | "playlist"; sourceUrl: string; title?: string | null; collectionId?: number | null },
): DownloadJob {
  const { lastInsertRowid } = db.run(
    "INSERT INTO download_jobs (type, source_url, title, collection_id, status) VALUES (?, ?, ?, ?, 'queued')",
    [input.type, input.sourceUrl, input.title ?? null, input.collectionId ?? null],
  );
  return getDownloadJob(db, Number(lastInsertRowid))!;
}

export function getDownloadJob(db: Database, id: number): DownloadJob | null {
  return db.query<DownloadJob, [number]>("SELECT * FROM download_jobs WHERE id = ?").get(id) ?? null;
}

export function listDownloadJobs(db: Database, limit = 25): DownloadJob[] {
  return db.query<DownloadJob, [number]>("SELECT * FROM download_jobs ORDER BY id DESC LIMIT ?").all(limit);
}

export function updateDownloadJob(
  db: Database,
  id: number,
  patch: {
    status?: DownloadJob["status"];
    completedItems?: number;
    totalItems?: number;
    error?: string | null;
    title?: string | null;
    collectionId?: number | null;
  },
): void {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.status !== undefined) (sets.push("status = ?"), params.push(patch.status));
  if (patch.completedItems !== undefined) (sets.push("completed_items = ?"), params.push(patch.completedItems));
  if (patch.totalItems !== undefined) (sets.push("total_items = ?"), params.push(patch.totalItems));
  if (patch.error !== undefined) (sets.push("error = ?"), params.push(patch.error));
  if (patch.title !== undefined) (sets.push("title = ?"), params.push(patch.title));
  if (patch.collectionId !== undefined) (sets.push("collection_id = ?"), params.push(patch.collectionId));
  if (!sets.length) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  db.run(`UPDATE download_jobs SET ${sets.join(", ")} WHERE id = ?`, params);
}

export function addJobItem(
  db: Database,
  input: { jobId: number; videoId: string; title: string; position: number },
): DownloadJobItem {
  const { lastInsertRowid } = db.run(
    "INSERT INTO download_job_items (job_id, video_id, title, position) VALUES (?, ?, ?, ?)",
    [input.jobId, input.videoId, input.title, input.position],
  );
  return db.query<DownloadJobItem, [number]>("SELECT * FROM download_job_items WHERE id = ?").get(Number(lastInsertRowid))!;
}

export function listJobItems(db: Database, jobId: number): DownloadJobItem[] {
  return db
    .query<DownloadJobItem, [number]>("SELECT * FROM download_job_items WHERE job_id = ? ORDER BY position")
    .all(jobId);
}

export function updateJobItem(
  db: Database,
  id: number,
  patch: { status?: DownloadJobItem["status"]; progressPct?: number; error?: string | null; trackId?: number | null },
): void {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.status !== undefined) (sets.push("status = ?"), params.push(patch.status));
  if (patch.progressPct !== undefined) (sets.push("progress_pct = ?"), params.push(patch.progressPct));
  if (patch.error !== undefined) (sets.push("error = ?"), params.push(patch.error));
  if (patch.trackId !== undefined) (sets.push("track_id = ?"), params.push(patch.trackId));
  if (!sets.length) return;
  params.push(id);
  db.run(`UPDATE download_job_items SET ${sets.join(", ")} WHERE id = ?`, params);
}

// --- API keys (Stream Deck, B26) ---

export interface ApiKey {
  id: number;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function createApiKey(
  db: Database,
  input: { userId: string; name: string; keyHash: string; keyPrefix: string },
): ApiKey {
  const { lastInsertRowid } = db.run(
    "INSERT INTO api_keys (user_id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
    [input.userId, input.name, input.keyHash, input.keyPrefix],
  );
  return db.query<ApiKey, [number]>("SELECT * FROM api_keys WHERE id = ?").get(Number(lastInsertRowid))!;
}

export function listApiKeys(db: Database, userId: string): ApiKey[] {
  return db.query<ApiKey, [string]>("SELECT * FROM api_keys WHERE user_id = ? ORDER BY id DESC").all(userId);
}

export function getApiKeyByHash(db: Database, hash: string): ApiKey | null {
  return db.query<ApiKey, [string]>("SELECT * FROM api_keys WHERE key_hash = ?").get(hash) ?? null;
}

/** Revoke a key, but only if it belongs to `userId` (ownership check). */
export function revokeApiKey(db: Database, id: number, userId: string): boolean {
  return (
    db.run("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [
      id,
      userId,
    ]).changes > 0
  );
}

export function touchApiKey(db: Database, id: number): void {
  db.run("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", [id]);
}

/**
 * Reconcile download jobs left mid-flight by a crash/restart (their worker
 * promises died with the process, but the rows still say queued/running so the
 * UI shows a perpetual import). Mark non-terminal items as error and the job as
 * partial (if anything finished) or error. Already-imported tracks are untouched
 * — re-importing is cheap thanks to video-id dedup (B23). Returns jobs touched.
 */
export function reconcileInterruptedJobs(db: Database): number {
  const jobs = db
    .query<DownloadJob, []>("SELECT * FROM download_jobs WHERE status IN ('queued','running')")
    .all();
  for (const job of jobs) {
    db.run(
      "UPDATE download_job_items SET status='error', error='interrupted by restart' WHERE job_id=? AND status IN ('queued','downloading')",
      [job.id],
    );
    const done =
      db.query<{ c: number }, [number]>(
        "SELECT COUNT(*) AS c FROM download_job_items WHERE job_id=? AND status='done'",
      ).get(job.id)?.c ?? 0;
    updateDownloadJob(db, job.id, {
      status: done > 0 ? "partial" : "error",
      completedItems: done,
      error: "interrupted by restart",
    });
  }
  return jobs.length;
}
