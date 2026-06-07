// Deferred in-voice draft assist (D-5, ratified; spec §6.1 note, §15 architecture B borrowed).
// Generates ONE short in-voice draft from a proposal's cited facts as an EDITABLE STARTING POINT
// for the reviewer — it is never auto-committed and never bypasses the human gate (C2/N3). The
// §9 voice warnings act as the warn-only "voice critic" over whatever the human ends up with.
//
// The load-bearing principle (spec §6) holds: the machine structures + cites; the human keeps the
// pen. This draft is a convenience, explicitly fragile (voice may be partially unlearnable, R1) —
// which is exactly why it is offered as a suggestion the human must accept or rewrite.
//
// LLM only via the core's complete() with DI (C5); cost is logged automatically by complete().

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';

const DraftSchema = z.object({ draft: z.string() });
export type DraftCompleteFn = (
  args: CompleteArgs<typeof DraftSchema>,
) => Promise<CompleteResult<typeof DraftSchema>>;

export interface DraftInput {
  canonicalName: string;
  kind: 'amend' | 'create';
  /** The cited facts backing this proposal — the only thing the draft may assert. */
  facts: { text: string }[];
  /** Surrounding page prose (amend) — the voice reference the draft must blend into. */
  pageContext?: string;
  /**
   * Reviewer instructions that condition the draft (NLSpec 0002 AC-6/D-7): the free-text note from a
   * `/merge <note>` command. Scoped + low-risk — the only free text the surface feeds the LLM. Absent
   * for every existing caller (the web-app draft assist passes only facts/pageContext).
   */
  instructions?: string;
}

export interface DraftOptions {
  model?: string;
  completeFn?: DraftCompleteFn;
}

export interface DraftResult {
  draft: string;
}

// The §9 "good prose" bar, distilled for generation. Calibrated against the verbatim GOOD/BAD
// examples in the spec. This is guidance for a STARTING POINT, not a promise of publishable prose.
const DRAFT_SYSTEM = `You draft a short passage for a hand-authored fantasy worldbuilding wiki with a strong literary voice. Your output is a STARTING POINT a human editor will rewrite — not final copy.

The voice (calibrate to this GOOD example): "Sableclutch is dominated by the dockworkers and warehouse employees that ply their trade on the river… somewhat overlooked by the rest of the capital — whilst many of the goods that enter into the city start their journey in Sableclutch, the power centers of the Orgs that manage it are found elsewhere." It is perspectival, states a tension or consequence, is specific (not listy), economical, idiomatic (literary, British-ish, em-dash asides), and weaves [[wikilinks]] into the prose.

NEVER write the slop archetype (this BAD example): "X is a large scrapyard located within the neighborhood. It is an expansive site featuring mountains of trash." Concretely:
- No encyclopedia opener — do NOT start "{Name} is a/an/the {type}…". Lead with a point of view, a consequence, or a tension.
- No filler intensifiers as volume (large, vast, expansive, numerous, various, massive, huge).
- No templated "It is …" second sentence.

Rules:
- Write 1–3 sentences. Pages are tiny; every clause must pull weight.
- Assert ONLY what the provided facts support. Do not invent specifics. No game mechanics, no stat blocks.
- When amending, match the surrounding paragraph's tense, POV, and naming so it reads as one continuous human paragraph — not a bolt-on.
- Weave [[wikilinks]] for named entities where natural.`;

function buildUser(input: DraftInput): string {
  const facts = input.facts.map((f) => `- ${f.text}`).join('\n');
  const parts = [
    `Subject: ${input.canonicalName} (${input.kind === 'amend' ? 'amending an existing page' : 'a new page'})`,
    '',
    'Cited facts to convey (assert nothing beyond these):',
    facts || '- (none)',
  ];
  if (input.kind === 'amend' && input.pageContext?.trim()) {
    parts.push(
      '',
      'Existing page prose (match this voice; your draft will be woven in — do not repeat it):',
      input.pageContext.trim(),
    );
  }
  if (input.instructions?.trim()) {
    parts.push(
      '',
      `Reviewer instruction (condition the draft on this, but assert nothing beyond the cited facts): ${input.instructions.trim()}`,
    );
  }
  parts.push('', 'Draft the passage now.');
  return parts.join('\n');
}

/**
 * Produce one in-voice draft passage as an editable starting point (D-5). Pure aside from the
 * injected LLM call; returns text only — it writes nothing and commits nothing.
 */
export async function draftProse(input: DraftInput, opts: DraftOptions = {}): Promise<DraftResult> {
  const run = opts.completeFn ?? complete;
  const model = opts.model ?? config().MODEL_DRAFT;
  const { value } = await run({
    stage: 'draft',
    page: input.canonicalName,
    model,
    system: DRAFT_SYSTEM,
    user: buildUser(input),
    schema: DraftSchema,
    maxTokens: 400,
  });
  return { draft: value.draft.trim() };
}
