import { $ } from "bun";

export interface AudioParams {
  sampleRate: number;
  channels: number;
  codec: string;
}

/** EBU R128 podcast loudness target. */
export const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";

/** Probe a clip's audio stream params via ffprobe. */
export async function probeClip(path: string): Promise<AudioParams> {
  const out = await $`ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels,codec_name -of json ${path}`.text();
  const stream = (JSON.parse(out).streams?.[0] ?? {}) as Record<string, unknown>;
  return {
    sampleRate: Number(stream.sample_rate) || 24000,
    channels: Number(stream.channels) || 1,
    codec: typeof stream.codec_name === "string" ? stream.codec_name : "mp3",
  };
}

/** ffmpeg codec args for an output `format` (mp3|wav). */
function codecArgs(format: string): string[] {
  return format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "128k"] : ["-c:a", "pcm_s16le"];
}

/** Generate a silence clip matching `params`, in `format` (mp3|wav), at `path`. */
export async function makeSilence(
  path: string,
  ms: number,
  params: AudioParams,
  format: string,
): Promise<void> {
  const seconds = (ms / 1000).toFixed(3);
  const layout = params.channels === 1 ? "mono" : "stereo";
  const src = `anullsrc=channel_layout=${layout}:sample_rate=${params.sampleRate}`;
  // Silence encodes fine at a low bitrate; speech clips use the full bitrate (codecArgs).
  const codec = format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "48k"] : ["-c:a", "pcm_s16le"];
  await $`ffmpeg -hide_banner -y -f lavfi -i ${src} -t ${seconds} -ac ${params.channels} -ar ${params.sampleRate} ${codec} ${path}`.quiet();
}

/**
 * Copy a clip with a short fade-in at the start and fade-out at the end, to tame
 * end-of-line clicks/transients before stitching. The out-fade is applied via
 * `areverse` so it needs no clip duration (and is safe on clips shorter than the
 * fade). Output matches `params`/`format` so the concat demuxer stays happy.
 */
export async function fadeClip(
  src: string,
  dst: string,
  params: AudioParams,
  format: string,
  fadeInMs: number,
  fadeOutMs: number,
): Promise<void> {
  const inSec = (fadeInMs / 1000).toFixed(3);
  const outSec = (fadeOutMs / 1000).toFixed(3);
  const af = `areverse,afade=t=in:st=0:d=${outSec},areverse,afade=t=in:st=0:d=${inSec}`;
  const codec = codecArgs(format);
  await $`ffmpeg -hide_banner -y -i ${src} -af ${af} -ac ${params.channels} -ar ${params.sampleRate} ${codec} ${dst}`.quiet();
}

/** Concatenate the list and loudness-normalize to a 128 kbps mp3 at `outPath`. */
export async function concatLoudnorm(listPath: string, outPath: string): Promise<void> {
  await $`ffmpeg -hide_banner -y -f concat -safe 0 -i ${listPath} -af ${LOUDNORM} -c:a libmp3lame -b:a 128k -ar 44100 ${outPath}`.quiet();
}
