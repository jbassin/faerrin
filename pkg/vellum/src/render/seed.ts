/**
 * Deterministic "imperfection" seed (R-17). Grime — slight stamp rotation and a
 * coffee/blood ring — is derived from a hash of the content, so the same
 * document always produces the same artifact (diff-stable, regenerates
 * identically), while different documents look distinct. Pure, no randomness.
 */

/** FNV-1a 32-bit string hash. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Grime {
  /** Stamp rotation in degrees, within ±2° (R-17). */
  rotateDeg: number;
  /** Coffee-ring centre as percentages of the card box. */
  ringX: number;
  ringY: number;
  /** Ring size multiplier. */
  ringScale: number;
}

/** Map a 32-bit seed to deterministic grime parameters. */
export function seededGrime(seed: number): Grime {
  // Pull independent-ish fields out of the seed via cheap mixing.
  const a = seed & 0xff;
  const b = (seed >>> 8) & 0xff;
  const c = (seed >>> 16) & 0xff;
  const d = (seed >>> 24) & 0xff;
  return {
    rotateDeg: Number(((a / 255) * 4 - 2).toFixed(2)), // -2°..+2°
    ringX: Math.round(15 + (b / 255) * 70), // 15%..85%
    ringY: Math.round(15 + (c / 255) * 70),
    ringScale: Number((0.8 + (d / 255) * 0.8).toFixed(2)), // 0.8..1.6
  };
}

/** Convenience: grime for a string of content. */
export function grimeFor(content: string): Grime {
  return seededGrime(hashString(content));
}
