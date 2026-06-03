import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import type { WikiIndex } from '../wiki/index-schema';
import type { Claim, EntityResolution } from '../transcript/extract';
import { buildIndexSummary } from './candidates';

export type ResolvedClaim = Claim & { entityResolutions: EntityResolution[] };

// ---- String normalization ----

export function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---- Levenshtein distance ----

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]!
        : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]!;
  }
  return prev[n]!;
}

const MIN_TOKEN_LEN = 4;
const FUZZY_RATIO_THRESHOLD = 0.25;

// Best normalised edit-distance ratio between any token pair (skips short tokens).
export function bestTokenPairDistance(entityNorm: string, titleNorm: string): number {
  const eToks = entityNorm.split(' ').filter((t) => t.length >= MIN_TOKEN_LEN);
  const tToks = titleNorm.split(' ').filter((t) => t.length >= MIN_TOKEN_LEN);
  if (eToks.length === 0 || tToks.length === 0) return Infinity;
  let best = Infinity;
  for (const et of eToks) {
    for (const tt of tToks) {
      const d = levenshtein(et, tt) / Math.max(et.length, tt.length);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---- Entity lookup tables ----

interface EntityLookup {
  exactMap:     Map<string, { title: string; path: string }>;
  fuzzyEntries: Array<{ titleNorm: string; title: string; path: string }>;
  aliasSet:     Map<string, Set<string>>;  // path → set of normalized alias strings
}

export function buildEntityLookup(index: WikiIndex): EntityLookup {
  const exactMap = new Map<string, { title: string; path: string }>();
  const fuzzyEntries: EntityLookup['fuzzyEntries'] = [];
  const aliasSet = new Map<string, Set<string>>();

  for (const [path, page] of Object.entries(index.pages)) {
    if (path.startsWith('Rules/')) continue;

    const titleNorm = normalizeStr(page.title);
    const add = (key: string, isAlias: boolean) => {
      if (!exactMap.has(key)) exactMap.set(key, { title: page.title, path });
      if (isAlias) {
        const set = aliasSet.get(path) ?? new Set<string>();
        set.add(key);
        aliasSet.set(path, set);
      }
    };
    add(titleNorm, false);
    for (const alias of page.aliases) add(normalizeStr(alias), true);

    fuzzyEntries.push({ titleNorm, title: page.title, path });
  }

  return { exactMap, fuzzyEntries, aliasSet };
}

// ---- LLM confirmation ----

const RESOLVE_SYSTEM_PREFIX = [
  'You are a name-resolution assistant for a Pathfinder 2e campaign wiki.',
  'For each item below, decide if the transcribed name is a variant of the candidate wiki entity.',
  'Answer only when confident; for uncertain cases emit confirmed: false.',
  'Be conservative — if in doubt, say false.',
  '',
].join('\n');

const ConfirmationsSchema = z.object({
  confirmations: z.array(z.object({
    index:     z.number().int().nonnegative(),
    confirmed: z.boolean(),
  })),
});

interface FuzzyCandidate {
  claimIdx:   number;
  entityIdx:  number;
  original:   string;
  title:      string;
  path:       string;
}

// ---- Core orchestrator ----

export interface AliasSuggestion {
  variant:     string;
  canonical:   string;
  page:        string;
  method:      'fuzzy' | 'llm';
  occurrences: number;
}

export interface ResolveTranscriptResult {
  claims:           ResolvedClaim[];
  aliasSuggestions: AliasSuggestion[];
  resolvedCount:    number;
  suggestionCount:  number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function resolveTranscript(
  claims: Claim[],
  index: WikiIndex,
  opts: {
    model:      string;
    transcript?: string;
    completeFn?: typeof defaultComplete;
  },
): Promise<ResolveTranscriptResult> {
  const fn = opts.completeFn ?? defaultComplete;
  const lookup = buildEntityLookup(index);

  // Work on deep copies so original claims are untouched.
  const resolved: ResolvedClaim[] = claims.map((c) => ({
    ...c,
    claim:    c.claim,
    entities: [...c.entities],
    entityResolutions: [],
  }));

  // Per-claim, per-entity resolution tracking.
  // We do exact-match first, then collect fuzzy candidates for batch LLM.
  const fuzzyQueue: FuzzyCandidate[] = [];

  for (let ci = 0; ci < resolved.length; ci++) {
    const claim = resolved[ci]!;
    for (let ei = 0; ei < claim.entities.length; ei++) {
      const original = claim.entities[ei]!;
      const norm = normalizeStr(original);

      // Tier 1: exact (normalized) match.
      const hit = lookup.exactMap.get(norm);
      if (hit) {
        claim.entityResolutions.push({
          original,
          canonical:    hit.title,
          page:         hit.path,
          method:       'exact',
          suggestAlias: false,
        });
        continue;
      }

      // Tier 2: fuzzy — find best match.
      let bestDist = Infinity;
      let bestEntry: EntityLookup['fuzzyEntries'][0] | null = null;
      for (const entry of lookup.fuzzyEntries) {
        const d = bestTokenPairDistance(norm, entry.titleNorm);
        if (d < bestDist) { bestDist = d; bestEntry = entry; }
      }

      if (bestEntry !== null && bestDist <= FUZZY_RATIO_THRESHOLD) {
        fuzzyQueue.push({ claimIdx: ci, entityIdx: ei, original, title: bestEntry.title, path: bestEntry.path });
      } else {
        // No candidate.
        claim.entityResolutions.push({
          original, canonical: original, page: null, method: 'none', suggestAlias: false,
        });
      }
    }
  }

  // Tier 3: batch LLM confirmation for fuzzy candidates.
  if (fuzzyQueue.length > 0) {
    const indexSummary = buildIndexSummary(index);
    const systemPrompt = RESOLVE_SYSTEM_PREFIX + indexSummary;

    const userLines = fuzzyQueue.map((c, i) => {
      const claimText = resolved[c.claimIdx]!.claim;
      return `[${i}] transcribed: "${c.original}" | candidate: "${c.title}" (${c.path}) | context claim: "${claimText}"`;
    });

    const result = await fn({
      stage:      'resolve',
      transcript: opts.transcript,
      model:      opts.model,
      cached:     systemPrompt,
      user:       userLines.join('\n'),
      schema:     ConfirmationsSchema,
      maxTokens:  2048,
    });

    const confirmedSet = new Set<number>(
      result.value.confirmations.filter((c) => c.confirmed).map((c) => c.index),
    );

    for (let i = 0; i < fuzzyQueue.length; i++) {
      const fc = fuzzyQueue[i]!;
      const claim = resolved[fc.claimIdx]!;

      if (confirmedSet.has(i)) {
        // Rewrite entity in the claim.
        claim.entities[fc.entityIdx] = fc.title;
        claim.claim = claim.claim.replace(new RegExp(escapeRegex(fc.original), 'gi'), fc.title);

        // Decide suggestAlias: true when the variant isn't already a registered alias.
        const normOrig = normalizeStr(fc.original);
        const aliases = lookup.aliasSet.get(fc.path) ?? new Set<string>();
        const alreadyAlias = aliases.has(normOrig) || normalizeStr(fc.title) === normOrig;
        claim.entityResolutions.push({
          original:    fc.original,
          canonical:   fc.title,
          page:        fc.path,
          method:      'llm',
          suggestAlias: !alreadyAlias,
        });
      } else {
        claim.entityResolutions.push({
          original: fc.original, canonical: fc.original, page: null, method: 'none', suggestAlias: false,
        });
      }
    }
  }

  // Collect alias suggestions (deduped by variant+page, counted).
  const suggestionMap = new Map<string, AliasSuggestion>();
  let resolvedCount = 0;
  for (const claim of resolved) {
    for (const r of claim.entityResolutions) {
      if (r.method === 'fuzzy' || r.method === 'llm') resolvedCount++;
      if (r.suggestAlias && r.page) {
        const key = `${r.original}\x00${r.page}`;
        const existing = suggestionMap.get(key);
        if (existing) {
          existing.occurrences++;
        } else {
          suggestionMap.set(key, {
            variant:     r.original,
            canonical:   r.canonical,
            page:        r.page,
            method:      r.method as 'fuzzy' | 'llm',
            occurrences: 1,
          });
        }
      }
    }
  }

  const aliasSuggestions = [...suggestionMap.values()];
  return { claims: resolved, aliasSuggestions, resolvedCount, suggestionCount: aliasSuggestions.length };
}
