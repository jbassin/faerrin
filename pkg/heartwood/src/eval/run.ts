// Eval runner (spec §12, AC-19): score a session's mined claims against the worldbuilder's
// hand-reviewed labels. Pure scoring + a markdown formatter; the CLI (scripts/eval.ts) wires
// the mine call. Coverage = recall (did we find the kept facts?), precision = how little
// noise leaked, false-canon = over-claiming among gm-stated claims.

import {
  scoreCoverage,
  scorePrecision,
  scoreFalseCanon,
  type CoverageResult,
  type PrecisionResult,
  type FalseCanonResult,
  type ScoreOptions,
} from './score';
import type { EvalLabel } from './labels';
import type { Claim } from '../pipeline/types';

export interface SessionScore {
  arc: string;
  date: string;
  labeledFacts: number;
  producedClaims: number;
  coverage: CoverageResult;
  precision: PrecisionResult;
  falseCanon: FalseCanonResult;
}

export function scoreSession(label: EvalLabel, claims: Claim[], opts: ScoreOptions = {}): SessionScore {
  return {
    arc: label.session.arc,
    date: label.session.date,
    labeledFacts: label.canonFacts.length,
    producedClaims: claims.length,
    coverage: scoreCoverage(label.canonFacts, claims, opts),
    precision: scorePrecision(label.canonFacts, claims, opts),
    falseCanon: scoreFalseCanon(label.canonFacts, claims, opts),
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

export function formatScore(s: SessionScore): string {
  return [
    `# Eval — ${s.arc}@${s.date}`,
    '',
    `- labeled (kept) facts: ${s.labeledFacts}`,
    `- mined claims:         ${s.producedClaims}`,
    `- **coverage (recall):  ${pct(s.coverage.coverage)}** (${s.coverage.covered}/${s.coverage.total}) — baseline to beat ~52%`,
    `- **precision:          ${pct(s.precision.precision)}** (${s.precision.matched}/${s.precision.total}) — unmatched claims are likely noise`,
    `- false-canon rate:     ${pct(s.falseCanon.falseCanonRate)} (${s.falseCanon.unmatched}/${s.falseCanon.canonClaims} gm-stated claims match no kept fact)`,
    '',
    s.coverage.missed.length ? `## Missed kept facts (${s.coverage.missed.length})` : '',
    ...s.coverage.missed.slice(0, 30).map((f) => `- ${f.statement}`),
    '',
    s.precision.unmatched.length ? `## Unmatched mined claims (${s.precision.unmatched.length}) — review for leaked noise` : '',
    ...s.precision.unmatched.slice(0, 30).map((c) => `- [${c.modality}] ${c.text}`),
  ]
    .filter((l) => l !== '')
    .join('\n');
}
