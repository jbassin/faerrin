// Pure geometry + deterministic-randomness helpers for the skein overlay.
// Kept free of Pixi types so it can be unit-tested without a renderer; the
// caller emits Graphics commands by walking the polyline samples this module
// produces.

const CURVE_SAMPLE_STEPS = 32; // → 33 polyline points per connection

export interface SkeinSignature {
  // Perpendicular offset of the Bezier control point as a fraction of chord
  // length. Signed so connections bow either way.
  bowFactor: number;
  // Where in the [0, 1) pulse loop this connection starts.
  phaseOffset: number;
  // Multiplier on PULSE_PERIOD — connections with speedMul > 1 advance more
  // slowly, < 1 faster.
  speedMul: number;
  beadCount: number;
  // Fraction of arc length between consecutive beads.
  beadSpacing: number;
  // Fraction of arc length covered by a bead's fading tail.
  tailLen: number;
}

export interface SkeinCurve {
  samples: ReadonlyArray<readonly [number, number]>;
  // cumLen[i] = arc length from samples[0] to samples[i]. cumLen[N-1] === arcLength.
  cumLen: ReadonlyArray<number>;
  arcLength: number;
}

// FNV-1a 32-bit. Stable across runs (no insertion-order dependence on Map).
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function skeinSignature(key: string): SkeinSignature {
  const rand = mulberry32(hashKey(key));
  const bowMag = 0.06 + rand() * 0.06; // 0.06..0.12
  const bowSign = rand() < 0.5 ? -1 : 1;
  const phaseOffset = rand();
  const speedMul = 0.8 + rand() * 0.4; // 0.8..1.2
  const beadCount = 3 + Math.floor(rand() * 3); // 3, 4, or 5
  const beadSpacing = 0.2 + rand() * 0.12; // 0.20..0.32
  const tailLen = 0.04 + rand() * 0.03; // 0.04..0.07
  return {
    bowFactor: bowMag * bowSign,
    phaseOffset,
    speedMul,
    beadCount,
    beadSpacing,
    tailLen,
  };
}

export function computeSkeinCurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sig: SkeinSignature,
): SkeinCurve {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) {
    return { samples: [[x1, y1]], cumLen: [0], arcLength: 0 };
  }
  // Control point on the perpendicular bisector of the chord.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -dy / chord;
  const ny = dx / chord;
  const offset = chord * sig.bowFactor;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;

  const samples: Array<readonly [number, number]> = new Array(
    CURVE_SAMPLE_STEPS + 1,
  );
  for (let i = 0; i <= CURVE_SAMPLE_STEPS; i++) {
    const t = i / CURVE_SAMPLE_STEPS;
    const u = 1 - t;
    // Quadratic Bezier: B(t) = u² P0 + 2ut P1 + t² P2
    const px = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const py = u * u * y1 + 2 * u * t * cy + t * t * y2;
    samples[i] = [px, py];
  }
  const cumLen: number[] = new Array(samples.length);
  cumLen[0] = 0;
  for (let i = 1; i < samples.length; i++) {
    const [ax, ay] = samples[i - 1];
    const [bx, by] = samples[i];
    cumLen[i] = cumLen[i - 1] + Math.hypot(bx - ax, by - ay);
  }
  return { samples, cumLen, arcLength: cumLen[cumLen.length - 1] };
}

// Sample the curve at normalized arc-length t ∈ [0, 1].
// Returns position and unit tangent (derived from the local polyline segment).
export function samplePoint(
  curve: SkeinCurve,
  t: number,
): { x: number; y: number; tx: number; ty: number } {
  const { samples, cumLen, arcLength } = curve;
  if (samples.length === 0 || arcLength === 0) {
    const p = samples[0] ?? [0, 0];
    return { x: p[0], y: p[1], tx: 1, ty: 0 };
  }
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const target = clamped * arcLength;
  // Find segment i..i+1 where cumLen[i] <= target <= cumLen[i+1].
  let lo = 0;
  let hi = cumLen.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumLen[mid] <= target) lo = mid;
    else hi = mid;
  }
  const segLen = cumLen[hi] - cumLen[lo];
  const frac = segLen === 0 ? 0 : (target - cumLen[lo]) / segLen;
  const [ax, ay] = samples[lo];
  const [bx, by] = samples[hi];
  const x = ax + (bx - ax) * frac;
  const y = ay + (by - ay) * frac;
  const dx = bx - ax;
  const dy = by - ay;
  const dlen = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / dlen, ty: dy / dlen };
}

// Return the polyline points to render up to arc-length fraction t ∈ [0, 1].
// The final point is interpolated to exactly t * arcLength so a draw-on
// animation grows smoothly rather than snapping between sample steps.
export function partialCurvePolyline(
  curve: SkeinCurve,
  t: number,
): Array<readonly [number, number]> {
  const { samples, cumLen, arcLength } = curve;
  if (samples.length === 0) return [];
  if (arcLength === 0) return [samples[0]];
  if (t <= 0) return [samples[0]];
  if (t >= 1) return samples.slice();
  const target = t * arcLength;
  const out: Array<readonly [number, number]> = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    if (cumLen[i] <= target) {
      out.push(samples[i]);
      continue;
    }
    const segLen = cumLen[i] - cumLen[i - 1];
    const frac = segLen === 0 ? 0 : (target - cumLen[i - 1]) / segLen;
    const [ax, ay] = samples[i - 1];
    const [bx, by] = samples[i];
    out.push([ax + (bx - ax) * frac, ay + (by - ay) * frac]);
    break;
  }
  return out;
}
