import type { Script, ScriptTurn, SpeakerId } from "../types.ts";

/**
 * "Tavern-ness" linter — mechanical metrics over a generated Script that
 * quantify how much it reads like friends at a tavern table vs. a polished
 * podcast. This is MEASUREMENT/REGRESSION tooling, not a gate: it turns the
 * vibe into numbers so prompt/generation changes can be compared, and flags the
 * podcast tells (uniform turns, recited agenda, no fumbles, every line a clean
 * quip) that the script-stage prompt is trying to suppress.
 *
 * It scores the mechanically measurable rubric criteria — R1-R4 and R6 (max 10,
 * = THRESHOLDS.length * 2). R5 (room / sensory references) was RETIRED: the recap
 * is friends in a tavern discussing a story with the room kept deliberately in the
 * background, so room-word density is no longer a quality signal (it once rewarded
 * exactly the waiter/ordering/food-and-drink business the prompt now suppresses).
 * The three judgment criteria (R7 voice-attribution, R8 unresolved friction, R9
 * coverage-vs-conversation) need a human or an LLM judge and are out of scope
 * here — the /18 acceptance bar is completed elsewhere.
 *
 * Thresholds are PROVISIONAL and calibration-pending: they were set against
 * hand-built fixtures, not real generated episodes. Re-tune `THRESHOLDS` once a
 * few real sessions have been linted (the plan's baseline step).
 */

const SPEAKERS: readonly SpeakerId[] = ["A", "B", "C"] as const;

/** Strip inline [audio tags] and tokenize a line into lowercased word tokens. */
export function words(text: string): string[] {
  return stripTags(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && w !== "-");
}

/** Remove inline ElevenLabs `[audio tags]` so they don't count as spoken words. */
function stripTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, " ");
}

// --- metric inputs ----------------------------------------------------------

/** Lines that announce the show's structure out loud — the meta-recap tell. */
const META_RECAP_PATTERNS: readonly RegExp[] = [
  /\bmoving on\b/,
  /\bmoving along\b/,
  /\bnext up\b/,
  /\bnext,/,
  /\blet's get into\b/,
  /\blet's dive\b/,
  /\blet's talk about\b/,
  /\bgetting into\b/,
  /\bbefore we wrap\b/,
  /\bwrap (it|things) up\b/,
  /\bthat's (all|it) for\b/,
  /\bto kick (us|things) off\b/,
  /\bwelcome (back|to the show)\b/,
  /\bin this episode\b/,
  /\bfirst up\b/,
  /\bfirst,/,
  /\bsecond,/,
  /\bthird,/,
  /\bfinally,/,
];

/** Per-turn disfluency / repair signals (interruptions, restarts, trailing off). */
function isDisfluentTurn(text: string): boolean {
  const t = stripTags(text).trim();
  if (/[—–-]\s*$/.test(t)) return true; // cut off mid-thought
  if (/(\.\.\.|…)\s*$/.test(t)) return true; // trailing off
  const lower = t.toLowerCase();
  return (
    /\bwait[,—–\s]/.test(lower) ||
    /\bno[,—–-]\s/.test(lower) ||
    /[—–-]\s*no\b/.test(lower) ||
    /\bi mean\b/.test(lower) ||
    /\bscratch that\b/.test(lower) ||
    /\bor[—–-]/.test(lower) ||
    /\bhang on\b/.test(lower)
  );
}

/** A "clean" line: a complete, punchy, uninterrupted sentence (the quip tell). */
function isCleanLine(text: string): boolean {
  const t = stripTags(text).trim();
  if (t.length === 0) return false;
  if (/[—–-]\s*$/.test(t) || /(\.\.\.|…)/.test(t)) return false; // interrupted/trailing
  if (/[—–]/.test(t)) return false; // mid-line dash = not clean
  if (!/[.!?]['"]?\s*$/.test(t)) return false; // must end terminally
  return words(t).length >= 3;
}

// --- metrics ----------------------------------------------------------------

export interface LintMetrics {
  turns: number;
  /** Mean pairwise Jaccard distance of each speaker's top content words (0-1, higher = more distinct). */
  vocabSpread: number;
  /** Stdev of words-per-turn across the whole script (higher = more uneven energy). */
  turnLengthStdev: number;
  /** Spread (max-min) of the three speakers' mean words-per-turn. */
  perSpeakerMeanSpread: number;
  /** Fraction of turns that announce the show's structure (lower = better). */
  metaRecapRatio: number;
  /** Fraction of turns carrying a disfluency/repair signal (higher = better, to a point). */
  disfluencyRatio: number;
  /** Fraction of turns that are clean complete sentences (lower = better — fewer uniform quips). */
  cleanLineRatio: number;
  /** Diagnostics (not scored): how evenly the floor is shared. */
  floorGiniTurns: number;
  floorGiniWords: number;
}

const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "is",
  "it", "i", "you", "he", "she", "they", "we", "that", "this", "was", "were",
  "be", "for", "with", "as", "so", "not", "no", "do", "did", "have", "has",
  "had", "what", "just", "like", "all", "out", "up", "if", "then", "there",
  "they're", "i'm", "it's", "that's", "don't",
]);

function topContentWords(turns: ScriptTurn[], n: number): Set<string> {
  const freq = new Map<string, number>();
  for (const t of turns) {
    for (const w of words(t.text)) {
      if (STOPWORDS.has(w) || w.length < 3) continue;
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return new Set(
    [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([w]) => w),
  );
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/** Gini coefficient of a non-negative distribution (0 = perfectly even). */
function gini(xs: number[]): number {
  const total = xs.reduce((s, x) => s + x, 0);
  if (total === 0 || xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) cum += (i + 1) * sorted[i]!;
  return (2 * cum) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

export function computeMetrics(script: Script): LintMetrics {
  const turns = script.turns;
  const wordCounts = turns.map((t) => words(t.text).length);

  // Per-speaker breakdowns.
  const perSpeakerTurns: ScriptTurn[][] = SPEAKERS.map((s) =>
    turns.filter((t) => t.speaker === s),
  );
  const perSpeakerMeans = perSpeakerTurns.map((ts) => {
    const counts = ts.map((t) => words(t.text).length);
    return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;
  });
  const meansPresent = perSpeakerMeans.filter((_, i) => perSpeakerTurns[i]!.length > 0);
  const perSpeakerMeanSpread =
    meansPresent.length > 1 ? Math.max(...meansPresent) - Math.min(...meansPresent) : 0;

  // R1: vocabulary distinctness — pairwise Jaccard distance of top words.
  const vocabSets = perSpeakerTurns.map((ts) => topContentWords(ts, 15));
  const pairs: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  const dists = pairs
    .filter(([i, j]) => vocabSets[i]!.size > 0 && vocabSets[j]!.size > 0)
    .map(([i, j]) => jaccardDistance(vocabSets[i]!, vocabSets[j]!));
  const vocabSpread = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;

  const metaRecap = turns.filter((t) => {
    const lower = stripTags(t.text).toLowerCase();
    return META_RECAP_PATTERNS.some((re) => re.test(lower));
  }).length;

  const disfluent = turns.filter((t) => isDisfluentTurn(t.text)).length;

  const cleanLines = turns.filter((t) => isCleanLine(t.text)).length;

  const n = turns.length || 1;
  return {
    turns: turns.length,
    vocabSpread,
    turnLengthStdev: stdev(wordCounts),
    perSpeakerMeanSpread,
    metaRecapRatio: metaRecap / n,
    disfluencyRatio: disfluent / n,
    cleanLineRatio: cleanLines / n,
    floorGiniTurns: gini(perSpeakerTurns.map((ts) => ts.length)),
    floorGiniWords: gini(
      perSpeakerTurns.map((ts) => ts.reduce((s, t) => s + words(t.text).length, 0)),
    ),
  };
}

// --- scoring ----------------------------------------------------------------

type Direction = "high" | "low";

interface Threshold {
  /** rubric id */
  id: string;
  label: string;
  metric: keyof LintMetrics;
  dir: Direction;
  /** value at/above (high) or at/below (low) which the score is 2 */
  two: number;
  /** value at/above (high) or at/below (low) which the score is 1 */
  one: number;
}

/** PROVISIONAL, calibration-pending. Re-tune against real linted episodes. */
export const THRESHOLDS: readonly Threshold[] = [
  { id: "R1", label: "per-speaker vocabulary spread", metric: "vocabSpread", dir: "high", two: 0.75, one: 0.55 },
  { id: "R2", label: "turn-length variance", metric: "turnLengthStdev", dir: "high", two: 6, one: 3 },
  { id: "R3", label: "meta-recap-line ratio", metric: "metaRecapRatio", dir: "low", two: 0.02, one: 0.08 },
  { id: "R4", label: "disfluency / repair rate", metric: "disfluencyRatio", dir: "high", two: 0.25, one: 0.12 },
  // R5 (room / sensory references) retired — see file header. The gap is intentional:
  // it preserves the R1-R9 rubric numbering (R6 keeps its id; R7-R9 are judgment criteria).
  { id: "R6", label: "quip density (clean-line ratio)", metric: "cleanLineRatio", dir: "low", two: 0.45, one: 0.65 },
] as const;

function scoreOne(value: number, t: Threshold): 0 | 1 | 2 {
  if (t.dir === "high") return value >= t.two ? 2 : value >= t.one ? 1 : 0;
  return value <= t.two ? 2 : value <= t.one ? 1 : 0;
}

export interface CriterionScore {
  id: string;
  label: string;
  value: number;
  score: 0 | 1 | 2;
}

export interface LintReport {
  metrics: LintMetrics;
  criteria: CriterionScore[];
  /** Sum of the mechanical criteria (R1-R4 and R6; max = THRESHOLDS.length * 2). */
  mechanicalSubtotal: number;
  /** Mechanical criteria scored 0 — a single one means a podcast tell survived. */
  zeros: string[];
}

export function scoreScript(script: Script): LintReport {
  const metrics = computeMetrics(script);
  const criteria: CriterionScore[] = THRESHOLDS.map((t) => ({
    id: t.id,
    label: t.label,
    value: metrics[t.metric],
    score: scoreOne(metrics[t.metric], t),
  }));
  return {
    metrics,
    criteria,
    mechanicalSubtotal: criteria.reduce((s, c) => s + c.score, 0),
    zeros: criteria.filter((c) => c.score === 0).map((c) => c.id),
  };
}

/** Human-readable report for the CLI. */
export function formatReport(report: LintReport): string {
  const lines: string[] = [];
  const max = THRESHOLDS.length * 2;
  lines.push("Tavern-ness (mechanical rubric R1-R4, R6; PROVISIONAL thresholds)");
  for (const c of report.criteria) {
    const bar = "●".repeat(c.score) + "○".repeat(2 - c.score);
    const val = Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(2);
    lines.push(`  ${bar} ${c.id} ${c.label}: ${val}`);
  }
  lines.push(`  mechanical subtotal: ${report.mechanicalSubtotal}/${max}`);
  lines.push(
    report.zeros.length
      ? `  ⚠ criteria at 0 (podcast tell survived): ${report.zeros.join(", ")}`
      : `  ✓ no mechanical criterion at 0`,
  );
  lines.push(
    `  (R7-R9 are human-judgment criteria; add them for the full /18 gate of >=13)`,
  );
  return lines.join("\n");
}
