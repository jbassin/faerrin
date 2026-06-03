import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim } from '../transcript/extract';

export interface CandidateResult {
  claimIndex: number;
  paths: string[];      // deduped, ordered by relevance, max 3, Rules/* excluded
  fastMatched: boolean; // true if any path came from the fast lookup
}

export interface FindCandidatesOptions {
  model: string;
  transcript?: string;
  batchSize?: number;          // claims per LLM fallback call, default 20
  completeFn?: typeof defaultComplete;
}

export function buildIndexSummary(index: WikiIndex): string {
  const lines: string[] = [
    'Available wiki pages (do not return paths not in this list):',
    '',
  ];
  for (const [path, page] of Object.entries(index.pages)) {
    if (path.startsWith('Rules/')) continue;
    const aliasStr = page.aliases.length ? ` (${page.aliases.join(', ')})` : '';
    lines.push(`${path} — ${page.title}${aliasStr} — ${page.summary ?? '(no summary)'}`);
  }
  return lines.join('\n');
}

const CANDIDATE_SYSTEM_PROMPT = [
  'You are a wiki page matching assistant for a Pathfinder 2e campaign.',
  'Given a numbered list of claims from session transcripts, identify which wiki pages each claim relates to.',
  'For each claim, return 0–3 page paths from the list below, ordered from most to least relevant.',
  'If no page is relevant, return an empty paths array for that claim.',
  'IMPORTANT: Only return paths exactly as shown in the list. Do not invent paths.',
  '',
  '{{INDEX_SUMMARY}}',
].join('\n');

const FallbackOutputSchema = z.object({
  matches: z.array(z.object({
    claimIndex: z.number().int().nonnegative(),
    paths: z.array(z.string()).max(3),
  })),
});

export async function findCandidates(
  claims: Claim[],
  index: WikiIndex,
  opts: FindCandidatesOptions,
): Promise<CandidateResult[]> {
  const batchSize = opts.batchSize ?? 20;
  const fn = opts.completeFn ?? defaultComplete;

  // Build fast-match lookup (title + aliases, lowercase, Rules/* excluded).
  const fastMap = new Map<string, string>();
  for (const [path, page] of Object.entries(index.pages)) {
    if (path.startsWith('Rules/')) continue;
    const add = (key: string) => { if (!fastMap.has(key)) fastMap.set(key, path); };
    add(page.title.toLowerCase());
    for (const alias of page.aliases) add(alias.toLowerCase());
  }

  const results: CandidateResult[] = claims.map((_, i) => ({
    claimIndex: i,
    paths: [],
    fastMatched: false,
  }));

  const fallbackIndices: number[] = [];

  for (let i = 0; i < claims.length; i++) {
    const entities = claims[i]!.entities;
    const paths = new Set<string>();
    for (const entity of entities) {
      const hit = fastMap.get(entity.toLowerCase());
      if (hit) paths.add(hit);
      if (paths.size >= 3) break;
    }
    if (paths.size > 0) {
      results[i]!.paths = [...paths].slice(0, 3);
      results[i]!.fastMatched = true;
    } else {
      fallbackIndices.push(i);
    }
  }

  if (fallbackIndices.length === 0) return results;

  // LLM fallback: batch unmatched claims.
  const indexSummary = buildIndexSummary(index);
  const cachedPrompt = CANDIDATE_SYSTEM_PROMPT.replace('{{INDEX_SUMMARY}}', indexSummary);
  const validPaths = new Set(
    Object.keys(index.pages).filter((p) => !p.startsWith('Rules/')),
  );

  for (let b = 0; b < fallbackIndices.length; b += batchSize) {
    const batch = fallbackIndices.slice(b, b + batchSize);
    const userLines = batch.map((i) => `[${i}] ${claims[i]!.claim}`);
    const result = await fn({
      stage: 'match-candidates',
      transcript: opts.transcript,
      model: opts.model,
      cached: cachedPrompt,
      user: userLines.join('\n'),
      schema: FallbackOutputSchema,
      maxTokens: 2048,
    });
    for (const m of result.value.matches) {
      if (m.claimIndex < 0 || m.claimIndex >= claims.length) continue;
      const validatedPaths = m.paths
        .filter((p) => validPaths.has(p))
        .slice(0, 3);
      if (validatedPaths.length > 0) {
        results[m.claimIndex]!.paths = validatedPaths;
      }
    }
  }

  return results;
}
