import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { Claim } from './extract';

export interface WorthinessResult {
  kept: Claim[];
  dropped: Claim[];
}

const WORTHINESS_SYSTEM_PROMPT = [
  'You are a wiki-worthiness classifier for a Pathfinder 2e campaign wiki.',
  'The wiki goal: encyclopedia entries for people, places, organizations, and lore.',
  '',
  'For each claim you receive, output a verdict:',
  '  "wiki"       — the claim describes a persistent world fact suitable for an encyclopedia',
  '  "transcript" — the claim is ephemeral session detail that does not belong in a wiki',
  '',
  'wiki-worthy (verdict: "wiki"):',
  '- Persistent entity descriptions: appearance, traits, clothing, mannerisms',
  '- Organizational facts: leadership, factions, hierarchy, purpose, location',
  '- Named places: nature, control, physical character',
  '- Lore and world-rules: magic, technology, society',
  '- Enduring relationships: alliances, enmities, employment, family',
  '- Historical events that shaped the world',
  '',
  'NOT wiki-worthy (verdict: "transcript"):',
  '- Scene blocking: who sat where, who handed what to whom',
  '- Combat blow-by-blow and dice outcomes',
  '- Single-session ephemeral events: "the party went to X", "Y arrived"',
  '- Dialogue paraphrase without a persistent world fact',
  '- Transient possessions or resources',
  '- Speculation or player theorizing',
  '',
  'Respond with a JSON object: { "verdicts": [ { "index": <number>, "verdict": "wiki" | "transcript" }, ... ] }',
  'Emit one entry per claim, in order, using the index you were given.',
].join('\n');

const VerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index:   z.number().int().nonnegative(),
      verdict: z.enum(['wiki', 'transcript']),
    }),
  ),
});

const BATCH_SIZE = 20;

export interface FilterByWorthinessOptions {
  model: string;
  transcript: string;
  completeFn?: typeof defaultComplete;
}

export async function filterByWorthiness(
  claims: Claim[],
  opts: FilterByWorthinessOptions,
): Promise<WorthinessResult> {
  if (claims.length === 0) return { kept: [], dropped: [] };

  const fn = opts.completeFn ?? defaultComplete;
  const kept: Claim[] = [];
  const dropped: Claim[] = [];

  for (let batchStart = 0; batchStart < claims.length; batchStart += BATCH_SIZE) {
    const batch = claims.slice(batchStart, batchStart + BATCH_SIZE);
    const userLines = batch.map((c, i) => `${i}: ${c.claim}`).join('\n');

    const result = await fn({
      stage:      'filter',
      transcript: opts.transcript,
      model:      opts.model,
      cached:     WORTHINESS_SYSTEM_PROMPT,
      user:       userLines,
      schema:     VerdictSchema,
      maxTokens:  1024,
    });

    const verdictMap = new Map((result.value.verdicts ?? []).map((v) => [v.index, v.verdict]));

    for (let i = 0; i < batch.length; i++) {
      const verdict = verdictMap.get(i) ?? 'wiki'; // default keep if missing
      if (verdict === 'wiki') {
        kept.push(batch[i]!);
      } else {
        dropped.push(batch[i]!);
      }
    }
  }

  return { kept, dropped };
}
