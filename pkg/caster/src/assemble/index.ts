import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { AudioManifest, Script } from "../types.ts";
import { DEFAULT_OUT_DIR } from "../distill/store.ts";
import { computeGaps, DEFAULT_GAP_OPTIONS, type GapOptions } from "./gaps.ts";
import { buildConcatList } from "./concat.ts";
import { renderTranscript } from "./transcript.ts";
import { concatLoudnorm, fadeClip, makeSilence, probeClip, type BedOptions } from "./ffmpeg.ts";

export { computeGaps, DEFAULT_GAP_OPTIONS } from "./gaps.ts";
export { buildConcatList } from "./concat.ts";
export { renderTranscript } from "./transcript.ts";
export { probeClip, makeSilence, fadeClip, concatLoudnorm, bedFilter } from "./ffmpeg.ts";
export type { BedOptions } from "./ffmpeg.ts";

/** Default ambient-bed gain: ~−23 dB under the −16 LUFS dialogue. */
export const DEFAULT_BED_GAIN = 0.07;

/** Short fades applied to each clip before stitching, to tame end-of-line clicks. */
export const DEFAULT_FADE_IN_MS = 10;
export const DEFAULT_FADE_OUT_MS = 80;

/** Uniform pause inserted between dialogue chunks (they're already paced inside). */
export const DEFAULT_CHUNK_GAP_MS = 300;

/** Max clips faded in parallel — keeps ffmpeg spawns bounded on long episodes. */
const FADE_CONCURRENCY = 8;

export interface AssembleOptions {
  outDir?: string;
  gapOptions?: GapOptions;
  /** Fade-in/out (ms) applied per clip to suppress boundary clicks (turns mode). */
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Pause between dialogue chunks (dialogue mode). */
  chunkGapMs?: number;
  /** Injectable RNG for deterministic jitter in tests. */
  rng?: () => number;
  /**
   * Mix a low ambient bed (e.g. tavern room tone) under the episode. Skipped with a
   * notice if `path` doesn't exist, so assembly still works without the local asset.
   */
  bed?: { path: string; gain?: number };
}

export interface EpisodeOutputs {
  audioPath: string;
  transcriptPath: string;
}

export function episodePath(sessionId: string, outDir = DEFAULT_OUT_DIR): string {
  return `${outDir}/${sessionId}.episode.mp3`;
}
export function transcriptPath(sessionId: string, outDir = DEFAULT_OUT_DIR): string {
  return `${outDir}/${sessionId}.transcript.md`;
}

/**
 * Stage 5: stitch a session's clips into one normalized episode and write a
 * transcript. "turns" manifests are stitched with jittered, faded per-turn
 * silence; "dialogue" manifests (ElevenLabs v3) are already paced inside each
 * chunk, so chunks are concatenated with a small uniform gap and no fades.
 * Both apply EBU R128 loudnorm. Requires ffmpeg/ffprobe on PATH.
 */
export async function assembleEpisode(
  manifest: AudioManifest,
  script: Script,
  options: AssembleOptions = {},
): Promise<EpisodeOutputs> {
  if (manifest.clips.length === 0) {
    throw new Error(`No clips to assemble for ${manifest.sessionId}.`);
  }
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const work = `${outDir}/${manifest.sessionId}.assemble`;
  await mkdir(work, { recursive: true });

  const audioPath = episodePath(manifest.sessionId, outDir);
  const tPath = transcriptPath(manifest.sessionId, outDir);
  try {
    const segments =
      manifest.mode === "dialogue"
        ? await prepareDialogue(manifest, work, options)
        : await prepareTurns(manifest, work, options);

    const listPath = `${work}/concat.txt`;
    await Bun.write(listPath, buildConcatList(segments.clipPaths, segments.gaps, segments.silenceFor));
    const bed = await resolveBed(manifest, segments, options.bed);
    await concatLoudnorm(resolve(listPath), resolve(audioPath), bed);

    await Bun.write(tPath, renderTranscript(script));
  } finally {
    // Always clean the temp work dir, even if ffmpeg failed mid-assembly.
    await rm(work, { recursive: true, force: true });
  }
  return { audioPath, transcriptPath: tPath };
}

interface Segments {
  clipPaths: string[];
  gaps: number[];
  silenceFor: (ms: number) => string;
}

/** "turns" mode: variable jittered gaps + per-clip fades to suppress clicks. */
async function prepareTurns(
  manifest: AudioManifest,
  work: string,
  options: AssembleOptions,
): Promise<Segments> {
  const gapOpts = options.gapOptions ?? DEFAULT_GAP_OPTIONS;
  const fadeInMs = options.fadeInMs ?? DEFAULT_FADE_IN_MS;
  const fadeOutMs = options.fadeOutMs ?? DEFAULT_FADE_OUT_MS;

  const speakers = manifest.clips.map((c) => c.speaker);
  const gaps = computeGaps(speakers, gapOpts, options.rng);
  const params = await probeClip(manifest.clips[0]!.path);
  const silenceFor = (ms: number) => resolve(`${work}/gap-${ms}.${manifest.format}`);
  for (const ms of new Set(gaps)) {
    await makeSilence(silenceFor(ms), ms, params, manifest.format);
  }

  // Fade each clip into the work dir (bounded concurrency) so an abrupt end
  // transient doesn't click at the stitch boundary; concat from the faded copies.
  const fadedPath = (i: number) =>
    resolve(`${work}/clip-${String(i + 1).padStart(3, "0")}.${manifest.format}`);
  for (let i = 0; i < manifest.clips.length; i += FADE_CONCURRENCY) {
    const batch = manifest.clips.slice(i, i + FADE_CONCURRENCY);
    await Promise.all(
      batch.map((c, j) =>
        fadeClip(resolve(c.path), fadedPath(i + j), params, manifest.format, fadeInMs, fadeOutMs),
      ),
    );
  }
  return { clipPaths: manifest.clips.map((_, i) => fadedPath(i)), gaps, silenceFor };
}

/** "dialogue" mode: concat pre-paced chunks with one uniform gap, no fades. */
async function prepareDialogue(
  manifest: AudioManifest,
  work: string,
  options: AssembleOptions,
): Promise<Segments> {
  const chunkGapMs = options.chunkGapMs ?? DEFAULT_CHUNK_GAP_MS;
  const params = await probeClip(manifest.clips[0]!.path);
  const silenceFor = (ms: number) => resolve(`${work}/gap-${ms}.${manifest.format}`);
  if (manifest.clips.length > 1) {
    await makeSilence(silenceFor(chunkGapMs), chunkGapMs, params, manifest.format);
  }
  const gaps = new Array(manifest.clips.length - 1).fill(chunkGapMs);
  return { clipPaths: manifest.clips.map((c) => resolve(c.path)), gaps, silenceFor };
}

/**
 * Resolve the ambient-bed config: returns undefined (no bed) when not requested or
 * when the file is missing (with a notice — assembly must still work without the
 * local asset). Episode length = clip durations + inter-clip gaps; the start offset
 * is a deterministic per-session seek into the (much longer) bed for variety.
 */
async function resolveBed(
  manifest: AudioManifest,
  segments: Segments,
  bedOpt: AssembleOptions["bed"],
): Promise<BedOptions | undefined> {
  if (!bedOpt) return undefined;
  if (!(await Bun.file(bedOpt.path).exists())) {
    console.error(`(bed: ${bedOpt.path} not found — assembling without an ambient bed)`);
    return undefined;
  }
  const clipMs = manifest.clips.reduce((sum, c) => sum + c.durationMs, 0);
  const gapMs = segments.gaps.reduce((sum, g) => sum + g, 0);
  return {
    path: resolve(bedOpt.path),
    gain: bedOpt.gain ?? DEFAULT_BED_GAIN,
    totalMs: clipMs + gapMs,
    startOffsetSec: bedOffset(manifest.sessionId),
  };
}

/** Deterministic seek (seconds) into the bed from the session id. Bounded well under
 * the bed length (~3 h) so even a long episode never runs past the end. */
function bedOffset(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return h % 7000;
}
