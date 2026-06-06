// Triage stage (spec §6.2, AC-1, AC-5, D-4). A second-pass LLM classifier that sorts mined
// claims into canon / uncertain / noise, catching residual leaked noise and routing
// non-canon-modality claims away from canon. The human confirms the split in the review UI;
// triage just makes that fast. Conservative: borderline → uncertain (D-4). DI via completeFn.

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';
import { type Claim, type Modality } from './types';
import { TRIAGE_SYSTEM } from './prompts';

export type TriageCategory = 'canon' | 'uncertain' | 'noise';

const TriageSchema = z.object({
  classifications: z.array(
    z.object({
      claimId: z.string(),
      category: z.enum(['canon', 'uncertain', 'noise']),
      reason: z.string(),
    }),
  ),
});

export type TriageCompleteFn = (
  args: CompleteArgs<typeof TriageSchema>,
) => Promise<CompleteResult<typeof TriageSchema>>;

export interface TriagedClaim {
  claim: Claim;
  category: TriageCategory;
  reason: string;
}

export interface TriageResult {
  items: TriagedClaim[];
  canon: Claim[];
  uncertain: Claim[];
  noise: Claim[];
}

/**
 * Enforce the spec's hard modality rule (AC-5): player-speculation and in-character-fiction
 * are never canon (downgraded to uncertain); a noise-modality claim is always noise.
 */
export function clampByModality(category: TriageCategory, modality: Modality): TriageCategory {
  if (modality === 'noise') return 'noise';
  if ((modality === 'player-speculation' || modality === 'in-character-fiction') && category === 'canon') {
    return 'uncertain';
  }
  return category;
}

export interface TriageOptions {
  model?: string;
  completeFn?: TriageCompleteFn;
}

export async function triage(claims: Claim[], opts: TriageOptions = {}): Promise<TriageResult> {
  if (claims.length === 0) return { items: [], canon: [], uncertain: [], noise: [] };

  const completeFn = opts.completeFn ?? (complete as TriageCompleteFn);
  const model = opts.model ?? config().MODEL_TRIAGE;

  const list = claims.map((c) => `${c.id} [${c.modality}]: ${c.text}`).join('\n');
  const { value } = await completeFn({
    stage: 'triage',
    model,
    cached: TRIAGE_SYSTEM,
    user: `Classify each candidate (canon / uncertain / noise):\n\n${list}`,
    schema: TriageSchema,
    maxTokens: 8192,
  });

  const byId = new Map<string, { category: TriageCategory; reason: string }>();
  for (const c of value.classifications) byId.set(c.claimId, { category: c.category, reason: c.reason });

  const items: TriagedClaim[] = claims.map((claim) => {
    const got = byId.get(claim.id);
    const raw = got?.category ?? 'uncertain'; // unclassified → uncertain (conservative)
    return { claim, category: clampByModality(raw, claim.modality), reason: got?.reason ?? 'unclassified' };
  });

  return {
    items,
    canon: items.filter((i) => i.category === 'canon').map((i) => i.claim),
    uncertain: items.filter((i) => i.category === 'uncertain').map((i) => i.claim),
    noise: items.filter((i) => i.category === 'noise').map((i) => i.claim),
  };
}
