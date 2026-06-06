// Eval scoring (spec §12, AC-19). Pure functions over labeled canon facts + produced claims.
//
// - coverage / recall: fraction of labeled canon facts the pipeline surfaced as a claim
//   (the headline metric; the old pipeline's ~52% is the baseline to beat).
// - false-canon rate: fraction of gm-stated (canon) claims that match NO labeled fact — a
//   guide to over-claiming/hallucination. Labels may be incomplete, so this is directional,
//   not a hard gate (spec §9/§12 note).
//
// Matching is intentionally simple and deterministic: shared entity + token similarity, or
// strong token similarity alone. Thresholds are explicit so the test pins behavior.

import { normalizeSentence } from '../anchor/anchor';
import { isCanonModality, type Claim } from '../pipeline/types';
import type { LabeledFact } from './labels';

export interface ScoreOptions {
  /** Token-Jaccard required when an entity also overlaps. */
  entityAssistedSim?: number;
  /** Token-Jaccard required with no entity overlap. */
  textOnlySim?: number;
}
const DEFAULTS: Required<ScoreOptions> = { entityAssistedSim: 0.25, textOnlySim: 0.6 };

function tokens(s: string): Set<string> {
  return new Set(normalizeSentence(s).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function entityOverlap(factEntities: string[], surfaceForms: string[]): boolean {
  const norm = (xs: string[]) => new Set(xs.map((x) => normalizeSentence(x)));
  const a = norm(factEntities);
  const b = norm(surfaceForms);
  for (const x of a) if (b.has(x)) return true;
  return false;
}

export function claimMatchesFact(fact: LabeledFact, claim: Claim, opts: ScoreOptions = {}): boolean {
  const o = { ...DEFAULTS, ...opts };
  const sim = jaccard(tokens(fact.statement), tokens(claim.text));
  if (sim >= o.textOnlySim) return true;
  if (entityOverlap(fact.entities, claim.entitySurfaceForms) && sim >= o.entityAssistedSim) return true;
  return false;
}

/**
 * A matcher decides whether a produced claim expresses the same world-fact as a labeled fact.
 * The default is deterministic token similarity (`claimMatchesFact`); the eval CLI can inject an
 * LLM-judge matcher (src/eval/judge.ts) for semantic, not token-level, equivalence.
 */
export type Matcher = (fact: LabeledFact, claim: Claim) => boolean;

export function tokenMatcher(opts: ScoreOptions = {}): Matcher {
  return (fact, claim) => claimMatchesFact(fact, claim, opts);
}

export interface CoverageResult {
  total: number;
  covered: number;
  coverage: number; // 0..1
  missed: LabeledFact[];
}

/** A labeled fact is covered if any produced claim matches it. */
export function scoreCoverage(facts: LabeledFact[], claims: Claim[], matcher: Matcher = tokenMatcher()): CoverageResult {
  const missed: LabeledFact[] = [];
  let covered = 0;
  for (const fact of facts) {
    if (claims.some((c) => matcher(fact, c))) covered++;
    else missed.push(fact);
  }
  const total = facts.length;
  return { total, covered, coverage: total === 0 ? 1 : covered / total, missed };
}

export interface PrecisionResult {
  total: number;
  matched: number;
  precision: number; // 0..1 — fraction of produced claims that match a labeled (kept) fact
  unmatched: Claim[]; // claims matching no kept fact — the likely event/combat/mechanics/plot noise
}

/**
 * Of the produced claims, the fraction that match a labeled (human-kept) fact. The unmatched
 * claims are the noise the reviewer would cut — a direct proxy for the slop the mine prompt
 * still leaks. (The label set is the human's kept facts, so this is a fair precision measure.)
 */
export function scorePrecision(facts: LabeledFact[], claims: Claim[], matcher: Matcher = tokenMatcher()): PrecisionResult {
  const unmatched: Claim[] = [];
  let matched = 0;
  for (const c of claims) {
    if (facts.some((f) => matcher(f, c))) matched++;
    else unmatched.push(c);
  }
  return {
    total: claims.length,
    matched,
    precision: claims.length === 0 ? 1 : matched / claims.length,
    unmatched,
  };
}

export interface FalseCanonResult {
  canonClaims: number;
  unmatched: number;
  falseCanonRate: number; // 0..1
}

/** Of canon-modality claims, the fraction matching no labeled fact (directional). */
export function scoreFalseCanon(facts: LabeledFact[], claims: Claim[], matcher: Matcher = tokenMatcher()): FalseCanonResult {
  const canon = claims.filter((c) => isCanonModality(c.modality));
  let unmatched = 0;
  for (const c of canon) {
    if (!facts.some((f) => matcher(f, c))) unmatched++;
  }
  return {
    canonClaims: canon.length,
    unmatched,
    falseCanonRate: canon.length === 0 ? 0 : unmatched / canon.length,
  };
}
