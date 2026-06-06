// Conflict stage (spec §6.2, AC-11, D-9, D-11). Entity-scoped contradiction detection: for each
// amend proposal, compare its new facts against the existing wiki page (and, optionally, prior
// canon for the same entity) and flag any new fact that CONTRADICTS what's already stated — not
// merely adds to it. Bounded cost (C1): only the entity's own page is read, never the whole wiki.
// Canon is one shared world (D-9); comparison is entity-scoped (D-11). The reviewer resolves each
// conflict (Supersede / Coexist / Reject, AC-11) — this stage only detects.

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';
import { pool } from '../util/pool';
import type { Proposal } from './assemble';

export interface Conflict {
  claimId: string;
  entityId: string;
  canonicalName: string;
  newStatement: string;
  /** The existing statement the new fact contradicts. */
  existingStatement: string;
  source: 'wiki';
  sourceRef: string; // wiki page path
  explanation: string;
}

export interface ConflictResult {
  conflicts: Conflict[];
  checkedPages: number;
}

const ConflictSchema = z.object({
  conflicts: z.array(
    z.object({
      claimId: z.string(),
      existingStatement: z.string(),
      explanation: z.string(),
    }),
  ),
});

export type ConflictCompleteFn = (
  args: CompleteArgs<typeof ConflictSchema>,
) => Promise<CompleteResult<typeof ConflictSchema>>;

const SYSTEM = `You check whether NEW facts proposed for a worldbuilding wiki page CONTRADICT what the page already says.

A CONTRADICTION means the new fact and an existing statement cannot both be true (e.g. the page says a city has six legs, the new fact says four). New or additional information that simply expands the page is NOT a contradiction — only flag genuine conflicts. Vague or compatible differences are not conflicts.

For each contradicting new fact, return its claimId, the exact existing statement it conflicts with, and a one-sentence explanation. If there are no contradictions, return an empty list.`;

export interface ConflictOptions {
  /** Read a wiki page's body by content-relative path; null if missing. */
  readPage: (wikiPath: string) => Promise<string | null>;
  model?: string;
  concurrency?: number;
  completeFn?: ConflictCompleteFn;
}

export async function detectConflicts(proposals: Proposal[], opts: ConflictOptions): Promise<ConflictResult> {
  const completeFn = opts.completeFn ?? (complete as ConflictCompleteFn);
  const model = opts.model ?? config().MODEL_CONFLICT;

  // Only amend proposals target an existing page; creates have nothing to contradict.
  const amends = proposals.filter((p) => p.kind === 'amend' && p.targetPath);

  let checkedPages = 0;
  const perPage = await pool(amends, opts.concurrency ?? 4, async (p) => {
    const body = await opts.readPage(p.targetPath!);
    if (!body || !body.trim()) return [] as Conflict[];
    checkedPages++;

    const factList = p.facts.map((f) => `${f.claimId}: ${f.text}`).join('\n');
    const { value } = await completeFn({
      stage: 'conflict',
      page: p.targetPath!,
      model,
      cached: SYSTEM,
      user: `EXISTING wiki page "${p.canonicalName}" (${p.targetPath}):\n${body}\n\nNEW facts proposed for this page:\n${factList}`,
      schema: ConflictSchema,
      maxTokens: 4096,
    });

    return value.conflicts.map((c): Conflict => {
      const fact = p.facts.find((f) => f.claimId === c.claimId);
      return {
        claimId: c.claimId,
        entityId: p.entityId,
        canonicalName: p.canonicalName,
        newStatement: fact?.text ?? '(unknown claim)',
        existingStatement: c.existingStatement,
        source: 'wiki',
        sourceRef: p.targetPath!,
        explanation: c.explanation,
      };
    });
  });

  return { conflicts: perPage.flat(), checkedPages };
}
