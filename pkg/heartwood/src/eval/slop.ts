// Slop-rate metric (spec §9 note, §12, AC-17). DELIBERATELY non-circular: it is computed from
// the reviewer's accept/edit/reject DECISIONS, never from the automated §9 voice warnings (which
// are merely inputs the reviewer may overrule). Slop = the share of decided proposals the reviewer
// rejected for voice/quality OR substantially rewrote away from a machine draft.
//
// In v1 there is no machine draft (the human authors all prose, D-5), so `rewrites` is 0 and the
// rate is driven by voice-tagged rejections. Once the deferred voice draft (D-5) lands, an approved
// proposal whose committed prose diverges from the offered draft also counts — still a reviewer
// decision, not a warning. Pure + deterministic for unit tests.

import { normalizeSentence } from '../anchor/anchor';
import { VOICE_REJECTION_REASONS } from '../state/quality';
import type { Decision } from '../state/review';

/** One decided proposal's signal for the slop metric. */
export interface SlopInput {
  decision: Decision;
  /** Tagged rejection reason (AC-16), if the decision was a rejection. */
  rejectionReason?: string;
  /** The machine voice-draft offered (D-5), if any. */
  draftText?: string;
  /** The prose the human actually committed/authored. */
  authoredText?: string;
}

export interface SlopResult {
  /** Terminal decisions (approved + rejected); deferred/pending are not counted. */
  decided: number;
  /** Rejected with a voice/quality reason (out-of-voice / hallucinated). */
  voiceRejections: number;
  /** Approved but the human rewrote substantially away from the offered draft (D-5). */
  rewrites: number;
  /** voiceRejections + rewrites. */
  slop: number;
  /** slop / decided (0 when nothing was decided). */
  slopRate: number;
  /** All rejection reasons tallied (tuning signal). */
  byReason: Record<string, number>;
}

export interface SlopOptions {
  /** Token-Jaccard below which an approved draft is judged "rewritten". */
  rewriteThreshold?: number;
}
const DEFAULT_REWRITE_THRESHOLD = 0.5;

function tokens(s: string): Set<string> {
  return new Set(normalizeSentence(s).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const VOICE_REASONS: readonly string[] = VOICE_REJECTION_REASONS;

export function slopRate(inputs: SlopInput[], opts: SlopOptions = {}): SlopResult {
  const threshold = opts.rewriteThreshold ?? DEFAULT_REWRITE_THRESHOLD;
  let decided = 0;
  let voiceRejections = 0;
  let rewrites = 0;
  const byReason: Record<string, number> = {};

  for (const it of inputs) {
    if (it.decision === 'approved') {
      decided++;
      if (it.draftText && it.authoredText) {
        if (jaccard(tokens(it.draftText), tokens(it.authoredText)) < threshold) rewrites++;
      }
    } else if (it.decision === 'rejected') {
      decided++;
      if (it.rejectionReason) {
        byReason[it.rejectionReason] = (byReason[it.rejectionReason] ?? 0) + 1;
        if (VOICE_REASONS.includes(it.rejectionReason)) voiceRejections++;
      }
    }
  }

  const slop = voiceRejections + rewrites;
  return {
    decided,
    voiceRejections,
    rewrites,
    slop,
    slopRate: decided === 0 ? 0 : slop / decided,
    byReason,
  };
}
