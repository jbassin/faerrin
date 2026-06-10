/**
 * SQLite schema as an ordered list of versioned migrations (plan §5).
 *
 * Each migration is applied once, tracked in `_migrations`. Migrations are
 * append-only: never edit a shipped one — add a new entry. The DDL is plain
 * `bun:sqlite`-compatible SQL so it can be applied to an in-memory DB in tests.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    sql: /* sql */ `
      CREATE TABLE collections (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        slug         TEXT    NOT NULL UNIQUE,
        ip_or_game   TEXT,
        source_type  TEXT    NOT NULL DEFAULT 'manual'
                     CHECK (source_type IN ('manual', 'youtube_playlist')),
        source_url   TEXT,
        cover_url    TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE tracks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id   INTEGER REFERENCES collections(id) ON DELETE SET NULL,
        title           TEXT    NOT NULL,
        original_title  TEXT    NOT NULL,
        source_type     TEXT    NOT NULL CHECK (source_type IN ('upload', 'youtube')),
        source_url      TEXT,
        source_video_id TEXT,
        file_path       TEXT,
        format          TEXT,
        duration_ms     INTEGER,
        file_size       INTEGER,
        loudness_lufs   REAL,
        status          TEXT    NOT NULL DEFAULT 'ready'
                        CHECK (status IN ('ready', 'downloading', 'error')),
        error           TEXT,
        added_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_tracks_collection ON tracks(collection_id);
      CREATE INDEX idx_tracks_video      ON tracks(source_video_id);

      CREATE TABLE tags (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        category   TEXT,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE track_tags (
        track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
        PRIMARY KEY (track_id, tag_id)
      );
      CREATE INDEX idx_track_tags_tag ON track_tags(tag_id);

      CREATE TABLE playlists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        loop_mode  TEXT    NOT NULL DEFAULT 'none'
                   CHECK (loop_mode IN ('none', 'track', 'playlist')),
        shuffle    INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE playlist_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
        position    INTEGER NOT NULL
      );
      CREATE INDEX idx_playlist_items_playlist ON playlist_items(playlist_id, position);

      CREATE TABLE download_jobs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        type            TEXT    NOT NULL CHECK (type IN ('single', 'playlist')),
        source_url      TEXT    NOT NULL,
        title           TEXT,
        collection_id   INTEGER REFERENCES collections(id) ON DELETE SET NULL,
        status          TEXT    NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'running', 'done', 'error', 'partial')),
        total_items     INTEGER NOT NULL DEFAULT 0,
        completed_items INTEGER NOT NULL DEFAULT 0,
        error           TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE download_job_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id       INTEGER NOT NULL REFERENCES download_jobs(id) ON DELETE CASCADE,
        video_id     TEXT    NOT NULL,
        title        TEXT    NOT NULL,
        position     INTEGER NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'downloading', 'done', 'error')),
        progress_pct REAL    NOT NULL DEFAULT 0,
        error        TEXT,
        track_id     INTEGER REFERENCES tracks(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_job_items_job ON download_job_items(job_id, position);

      CREATE TABLE api_keys (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT    NOT NULL,
        name         TEXT    NOT NULL,
        key_hash     TEXT    NOT NULL UNIQUE,
        key_prefix   TEXT    NOT NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        revoked_at   TEXT
      );
      CREATE INDEX idx_api_keys_user ON api_keys(user_id);
    `,
  },
];
