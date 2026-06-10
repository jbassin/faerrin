/**
 * Multipart upload ingest (plan B19). Stores each uploaded audio file under the
 * data dir, probes it (injected prober), and creates a `ready` track. The store
 * + DB logic is testable with a stub prober and a temp dir (no ffmpeg).
 */
import { mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { type Track, createTrack } from "../db/repo";
import type { AudioProbe, AudioProber } from "../media/probe";

export interface UploadResult {
  created: Track[];
  errors: { name: string; error: string }[];
}

const AUDIO_EXTS = new Set([".mp3", ".flac", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".webm"]);

/** Sanitize a display title from an uploaded filename (drop extension). */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return base.replace(/[_]+/g, " ").trim() || name;
}

export async function handleUpload(opts: {
  db: Database;
  dataDir: string;
  files: File[];
  collectionId?: number | null;
  prober?: AudioProber;
}): Promise<UploadResult> {
  const audioDir = resolve(opts.dataDir, "audio");
  await mkdir(audioDir, { recursive: true });
  const result: UploadResult = { created: [], errors: [] };

  for (const file of opts.files) {
    try {
      const ext = (extname(file.name) || ".bin").toLowerCase();
      if (!AUDIO_EXTS.has(ext)) {
        result.errors.push({ name: file.name, error: `unsupported file type ${ext}` });
        continue;
      }
      const id = crypto.randomUUID();
      const dest = resolve(audioDir, `${id}${ext}`);
      await Bun.write(dest, file);
      const probe: AudioProbe = opts.prober ? await opts.prober(dest).catch((): AudioProbe => ({})) : {};
      const track = createTrack(opts.db, {
        collectionId: opts.collectionId ?? null,
        title: titleFromFilename(file.name),
        originalTitle: file.name,
        sourceType: "upload",
        filePath: dest,
        format: probe.format ?? ext.slice(1),
        durationMs: probe.durationMs ?? null,
        fileSize: file.size,
        loudnessLufs: probe.loudnessLufs ?? null,
        status: "ready",
      });
      result.created.push(track);
    } catch (err) {
      result.errors.push({ name: file.name, error: (err as Error).message });
    }
  }
  return result;
}
