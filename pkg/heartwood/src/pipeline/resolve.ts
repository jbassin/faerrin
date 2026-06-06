// Resolve stage (spec §6.2, AC-20, D-9/D-11 inputs). Map each claim's entity surface forms to a
// canonical entity + existing wiki page, using the wiki's title/alias index for exact matches and
// an LLM pass for variants and generic referents ("the forest" → the Verdant Expanse, "Iomene" →
// "Iomenei"). Exact wiki matches are high-confidence; anything the LLM merges or any new entity is
// flagged for human confirmation (never silently auto-merged — AC-20). DI via completeFn.

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';
import { normalizeSentence } from '../anchor/anchor';
import type { Claim } from './types';
import type { WikiIndex } from '../wiki/index-schema';

export interface ResolvedEntity {
  id: string;
  canonicalName: string;
  aliases: string[]; // surface forms seen for this entity (original spellings)
  wikiPath: string | null; // existing page, or null when pending (new)
  status: 'known' | 'pending';
  confidence: 'high' | 'low'; // high = exact wiki match; low = LLM merge / referent / new (confirm)
}

export interface ResolvedClaim {
  claim: Claim;
  entityIds: string[];
}

export interface ResolveResult {
  entities: ResolvedEntity[];
  claims: ResolvedClaim[];
  /** Low-confidence entities (LLM merges + new entities) the human must confirm (AC-20). */
  needsConfirmation: ResolvedEntity[];
}

const ResolveLLMSchema = z.object({
  resolutions: z.array(
    z.object({
      surfaceForm: z.string(),
      /** A known wiki entity this is a variant/alias/referent of, or null if it's new. */
      matchedKnown: z.string().nullable(),
      /** Canonical name: the known entity's name when matched, else a clean new-entity name. */
      canonicalName: z.string(),
    }),
  ),
});

export type ResolveCompleteFn = (
  args: CompleteArgs<typeof ResolveLLMSchema>,
) => Promise<CompleteResult<typeof ResolveLLMSchema>>;

const SYSTEM = `You resolve entity references from a tabletop session against a known worldbuilding wiki.

You are given UNRESOLVED surface forms (entity mentions that didn't exactly match a wiki page) and a list of KNOWN wiki entities. For EACH surface form decide:
- Is it a variant, alternate spelling, alias, or generic referent of a KNOWN entity? (e.g. "the forest" → "Verdant Expanse", "Iomene" → "Iomenei", "the TA" → "Threshold Authority"). If so, set matchedKnown to that known entity's name and canonicalName to the same known name.
- Otherwise it is a NEW entity not yet in the wiki: set matchedKnown to null and give a clean canonicalName, using the SAME canonicalName for surface forms that refer to the same new entity (cluster variants together).

Be conservative: only match to a known entity when you are confident it is the same thing. Return exactly one entry per surface form.`;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entity';
}

interface WikiEntry { path: string; title: string }

function buildWikiLookup(index: WikiIndex): { byName: Map<string, WikiEntry>; names: string[] } {
  const byName = new Map<string, WikiEntry>();
  const names: string[] = [];
  for (const page of Object.values(index.pages)) {
    const entry: WikiEntry = { path: page.path, title: page.title };
    const add = (name: string) => {
      const key = normalizeSentence(name);
      if (key && !byName.has(key)) byName.set(key, entry);
    };
    add(page.title);
    names.push(page.title);
    for (const alias of page.aliases) { add(alias); names.push(alias); }
  }
  return { byName, names };
}

export interface ResolveOptions {
  index: WikiIndex;
  model?: string;
  completeFn?: ResolveCompleteFn;
}

export async function resolve(claims: Claim[], opts: ResolveOptions): Promise<ResolveResult> {
  const { byName, names } = buildWikiLookup(opts.index);

  // Collect unique surface forms (normalized key → a representative original spelling).
  const forms = new Map<string, string>();
  for (const c of claims) for (const sf of c.entitySurfaceForms) {
    const key = normalizeSentence(sf);
    if (key && !forms.has(key)) forms.set(key, sf.trim());
  }

  // entityId for each surface-form key, and the entity registry being assembled.
  const formToEntity = new Map<string, string>();
  const entities = new Map<string, ResolvedEntity>();

  const upsert = (id: string, e: () => ResolvedEntity, alias: string, confidence: 'high' | 'low') => {
    const existing = entities.get(id);
    if (!existing) {
      const fresh = e();
      if (!fresh.aliases.includes(alias)) fresh.aliases.push(alias);
      entities.set(id, fresh);
    } else {
      if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
      if (confidence === 'low') existing.confidence = 'low';
    }
    return id;
  };

  // 1. Deterministic exact wiki match.
  const unresolved: string[] = [];
  for (const [key, display] of forms) {
    const hit = byName.get(key);
    if (hit) {
      const id = `wiki:${hit.path}`;
      formToEntity.set(key, upsert(id, () => ({
        id, canonicalName: hit.title, aliases: [], wikiPath: hit.path, status: 'known', confidence: 'high',
      }), display, 'high'));
    } else {
      unresolved.push(display);
    }
  }

  // 2. LLM pass for the rest (variants, referents, new entities).
  if (unresolved.length > 0) {
    const completeFn = opts.completeFn ?? (complete as ResolveCompleteFn);
    const model = opts.model ?? config().MODEL_RESOLVE;
    const { value } = await completeFn({
      stage: 'resolve',
      model,
      cached: SYSTEM,
      user: `KNOWN wiki entities:\n${names.join('\n')}\n\nUNRESOLVED surface forms:\n${unresolved.join('\n')}`,
      schema: ResolveLLMSchema,
      maxTokens: 8192,
    });

    const byForm = new Map<string, { matchedKnown: string | null; canonicalName: string }>();
    for (const r of value.resolutions) byForm.set(normalizeSentence(r.surfaceForm), { matchedKnown: r.matchedKnown, canonicalName: r.canonicalName });

    for (const display of unresolved) {
      const key = normalizeSentence(display);
      const r = byForm.get(key);
      const known = r?.matchedKnown ? byName.get(normalizeSentence(r.matchedKnown)) : undefined;
      if (known) {
        const id = `wiki:${known.path}`;
        formToEntity.set(key, upsert(id, () => ({
          id, canonicalName: known.title, aliases: [], wikiPath: known.path, status: 'known', confidence: 'low',
        }), display, 'low')); // LLM-suggested merge → confirm
      } else {
        const canonical = r?.canonicalName?.trim() || display;
        const id = `new:${slug(canonical)}`;
        formToEntity.set(key, upsert(id, () => ({
          id, canonicalName: canonical, aliases: [], wikiPath: null, status: 'pending', confidence: 'low',
        }), display, 'low')); // new entity → confirm
      }
    }
  }

  // 3. Annotate claims with their resolved entity ids.
  const resolvedClaims: ResolvedClaim[] = claims.map((claim) => {
    const ids = new Set<string>();
    for (const sf of claim.entitySurfaceForms) {
      const id = formToEntity.get(normalizeSentence(sf));
      if (id) ids.add(id);
    }
    return { claim, entityIds: [...ids] };
  });

  const all = [...entities.values()];
  return { entities: all, claims: resolvedClaims, needsConfirmation: all.filter((e) => e.confidence === 'low') };
}
