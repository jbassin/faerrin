import type { SpeakerId } from "../types.ts";

export interface GapOptions {
  /** Silence between consecutive turns by the same speaker. */
  withinMs: number;
  /** Silence when the speaker changes (a beat to "hand off"). */
  changeMs: number;
  /** Max +/- random jitter applied to each gap, for a less robotic rhythm. */
  jitterMs: number;
  /** Quantize gaps to this step so only a few distinct silence files are needed. */
  quantizeMs: number;
  minMs: number;
  maxMs: number;
}

export const DEFAULT_GAP_OPTIONS: GapOptions = {
  withinMs: 200,
  changeMs: 400,
  jitterMs: 100,
  quantizeMs: 50,
  minMs: 100,
  maxMs: 800,
};

/**
 * Compute the inter-turn gap (ms) to place AFTER each turn except the last —
 * shorter within a speaker's run, longer on a speaker change, with quantized
 * jitter. `rng` is injectable (defaults to Math.random) so tests are deterministic.
 * Returns an array of length `speakers.length - 1`.
 */
export function computeGaps(
  speakers: SpeakerId[],
  opts: GapOptions = DEFAULT_GAP_OPTIONS,
  rng: () => number = Math.random,
): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < speakers.length - 1; i++) {
    const changed = speakers[i + 1] !== speakers[i];
    const base = changed ? opts.changeMs : opts.withinMs;
    const jitter = (rng() * 2 - 1) * opts.jitterMs;
    const quantized = Math.round((base + jitter) / opts.quantizeMs) * opts.quantizeMs;
    gaps.push(Math.max(opts.minMs, Math.min(opts.maxMs, quantized)));
  }
  return gaps;
}
