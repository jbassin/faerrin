/**
 * Loudness-normalization gain (plan B25/D5). Pure math + ffmpeg filter string —
 * the engine applies the measured-vs-target delta as live gain at playback,
 * never re-encoding the source. A true-peak limiter guards against clipping when
 * boosting quiet tracks.
 */
export interface GainOptions {
  /** Target integrated loudness, LUFS (e.g. -16). */
  targetLufs: number;
  /** Cap on positive boost to avoid amplifying noise/clipping (default +12 dB). */
  maxBoostDb?: number;
  /** Cap on attenuation (default 30 dB). */
  maxAttenuationDb?: number;
}

/** dB → linear amplitude ratio. */
export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Gain (dB) to bring `measuredLufs` toward the target. Unmeasured tracks play at
 * unity (0 dB). Result is clamped to the boost/attenuation caps.
 */
export function computeGainDb(measuredLufs: number | null | undefined, opts: GainOptions): number {
  if (measuredLufs == null || !Number.isFinite(measuredLufs)) return 0;
  const raw = opts.targetLufs - measuredLufs;
  const maxBoost = opts.maxBoostDb ?? 12;
  const maxAtten = opts.maxAttenuationDb ?? 30;
  return Math.max(-maxAtten, Math.min(maxBoost, raw));
}

/**
 * Build the ffmpeg `-af` filter chain: optional volume gain + a true-peak
 * limiter at `truePeakCeilingDb` (default -1 dBTP).
 */
export function buildAudioFilter(gainDb: number, truePeakCeilingDb = -1): string {
  const parts: string[] = [];
  if (Math.abs(gainDb) > 0.01) parts.push(`volume=${gainDb.toFixed(2)}dB`);
  parts.push(`alimiter=limit=${dbToLinear(truePeakCeilingDb).toFixed(4)}`);
  return parts.join(",");
}
