// Assemble stage (spec §6.1/§6.2, AC-22, AC-23, D-5). Group triaged canon claims (with their
// resolved entities) into per-page proposals — amend an existing wiki page or create a new one —
// and generate a short session narrative for reviewer orientation. Per D-5 this does NOT generate
// wiki prose; it groups the facts a human will write up. The narrative is orientation only (it may
// describe session events), not wiki content. DI via completeFn.

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';
import type { Claim, Citation, Modality } from './types';
import type { ResolveResult } from './resolve';

export interface ProposalFact {
  claimId: string;
  text: string;
  citations: Citation[];
  modality: Modality;
}

export interface Proposal {
  id: string;
  kind: 'amend' | 'create';
  status: 'existing' | 'new';
  entityId: string;
  canonicalName: string;
  /** Existing page path (amend), or null for a new page (path chosen at review, AC-10). */
  targetPath: string | null;
  facts: ProposalFact[];
}

export interface AssembleResult {
  proposals: Proposal[];
  narrative: string;
  /** Canon claims with no resolved entity (no home) — should be empty after resolve. */
  unassigned: ProposalFact[];
}

const NarrativeSchema = z.object({ narrative: z.string() });
export type AssembleCompleteFn = (
  args: CompleteArgs<typeof NarrativeSchema>,
) => Promise<CompleteResult<typeof NarrativeSchema>>;

const NARRATIVE_SYSTEM = `You write a SHORT orientation summary (one paragraph, ~3-6 sentences) of what a tabletop session revealed about the world, for the worldbuilder about to review proposed wiki updates. Summarize the notable people, places, organizations, and developments. This is orientation for the reviewer — NOT wiki prose — so a light narrative touch is fine. Be concise and factual.`;

function factOf(claim: Claim): ProposalFact {
  return { claimId: claim.id, text: claim.text, citations: claim.citations, modality: claim.modality };
}

export interface AssembleOptions {
  model?: string;
  completeFn?: AssembleCompleteFn;
  /** Skip the narrative LLM call (default false). */
  noNarrative?: boolean;
}

/**
 * @param canon   the canon-bucket claims from triage
 * @param resolved the resolve result (claim → entity ids, and the entity registry)
 */
export async function assemble(
  canon: Claim[],
  resolved: ResolveResult,
  opts: AssembleOptions = {},
): Promise<AssembleResult> {
  const entityIdsByClaim = new Map<string, string[]>();
  for (const rc of resolved.claims) entityIdsByClaim.set(rc.claim.id, rc.entityIds);
  const entityById = new Map(resolved.entities.map((e) => [e.id, e]));

  // Group each canon claim under its primary (first) resolved entity → one proposal per entity.
  const byEntity = new Map<string, ProposalFact[]>();
  const unassigned: ProposalFact[] = [];
  for (const claim of canon) {
    const primary = entityIdsByClaim.get(claim.id)?.[0];
    if (!primary || !entityById.has(primary)) { unassigned.push(factOf(claim)); continue; }
    (byEntity.get(primary) ?? byEntity.set(primary, []).get(primary)!).push(factOf(claim));
  }

  const proposals: Proposal[] = [];
  for (const [entityId, facts] of byEntity) {
    const e = entityById.get(entityId)!;
    const known = e.status === 'known';
    proposals.push({
      id: `prop:${entityId}`,
      kind: known ? 'amend' : 'create',
      status: known ? 'existing' : 'new',
      entityId,
      canonicalName: e.canonicalName,
      targetPath: e.wikiPath,
      facts,
    });
  }
  // Amend (existing pages) first, then creates; each group alphabetical for stable output.
  proposals.sort(
    (a, b) => Number(a.kind === 'create') - Number(b.kind === 'create') || a.canonicalName.localeCompare(b.canonicalName),
  );

  let narrative = '';
  if (!opts.noNarrative && canon.length > 0) {
    const completeFn = opts.completeFn ?? (complete as AssembleCompleteFn);
    const model = opts.model ?? config().MODEL_SUMMARIZE;
    const { value } = await completeFn({
      stage: 'assemble-narrative',
      model,
      cached: NARRATIVE_SYSTEM,
      user: `Canon facts established this session:\n${canon.map((c) => `- ${c.text}`).join('\n')}`,
      schema: NarrativeSchema,
      maxTokens: 1024,
    });
    narrative = value.narrative.trim();
  }

  return { proposals, narrative, unassigned };
}
