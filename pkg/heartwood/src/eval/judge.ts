// LLM-judge matcher for the eval (spec §12). The token matcher in score.ts can't tell semantic
// equivalence ("Iomenei walks on six legs" vs "the Strider is propelled by six legs"), which makes
// coverage/precision pessimistic and hard to tune against. The judge asks the model, in one call,
// which mined claims correspond to which human-kept facts, yielding a trustworthy match map.

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';
import type { LabeledFact } from './labels';
import type { Claim } from '../pipeline/types';
import type { Matcher } from './score';

/** claimId -> matching factId, or null when the claim matches no kept fact. */
export type MatchMap = Map<string, string | null>;

const JudgeSchema = z.object({
  matches: z.array(
    z.object({
      claimId: z.string(),
      factId: z.string().nullable(),
    }),
  ),
});

export type JudgeCompleteFn = (
  args: CompleteArgs<typeof JudgeSchema>,
) => Promise<CompleteResult<typeof JudgeSchema>>;

const SYSTEM = `You match AI-extracted CANDIDATE facts against a human-curated list of CANONICAL facts about a fictional tabletop setting.

For each candidate, decide which canonical fact (if any) expresses the SAME underlying world-fact — even if worded differently, more or less detailed, or phrased from another angle. They match when a reader would treat them as the same piece of information about the same entity. A candidate that corresponds to no canonical fact gets null.

Return exactly one entry per candidate (by its id), with the matching canonical fact id or null. Each canonical fact may match multiple candidates.`;

export async function judgeMatchMap(
  facts: LabeledFact[],
  claims: Claim[],
  opts: { model?: string; completeFn?: JudgeCompleteFn } = {},
): Promise<MatchMap> {
  const map: MatchMap = new Map();
  if (claims.length === 0) return map;

  const completeFn = opts.completeFn ?? (complete as JudgeCompleteFn);
  const model = opts.model ?? config().MODEL_CONFLICT; // Sonnet-class judge
  const factList = facts.map((f) => `${f.id}: ${f.statement}`).join('\n');
  const claimList = claims.map((c) => `${c.id}: ${c.text}`).join('\n');

  const { value } = await completeFn({
    stage: 'eval-judge',
    model,
    cached: SYSTEM,
    user: `CANONICAL facts:\n${factList || '(none)'}\n\nCANDIDATE facts:\n${claimList}`,
    schema: JudgeSchema,
    maxTokens: 8192,
  });

  const validFactIds = new Set(facts.map((f) => f.id));
  for (const m of value.matches) {
    map.set(m.claimId, m.factId && validFactIds.has(m.factId) ? m.factId : null);
  }
  for (const c of claims) if (!map.has(c.id)) map.set(c.id, null); // judge omissions → null
  return map;
}

export function matcherFromMap(map: MatchMap): Matcher {
  return (fact, claim) => map.get(claim.id) === fact.id;
}
