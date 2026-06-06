// Eval label schema (spec §12, AC-19, D-12). The worldbuilder hand-labels ~2 sessions across
// ≥2 arcs with the canon facts that SHOULD be captured (for recall) and optional good/bad
// sentence exemplars (for slop calibration). Everything downstream is tuned against this.

import { z } from 'zod';

export const LabeledFactSchema = z.object({
  id: z.string(),
  /** The canon fact, in plain language, that the pipeline should surface as a claim. */
  statement: z.string().min(1),
  /** Entities the fact concerns (used to match produced claims). */
  entities: z.array(z.string()),
  /** Optional transcript line span(s) the fact comes from. */
  citations: z.array(z.object({ start: z.number().int(), end: z.number().int() })).optional(),
  /** Set true once a human has approved/edited this fact in the review CLI (for resume). */
  reviewed: z.boolean().optional(),
});
export type LabeledFact = z.infer<typeof LabeledFactSchema>;

export const EvalLabelSchema = z.object({
  session: z.object({ arc: z.string(), date: z.string() }),
  /** Canon facts that should be captured from this session (the recall target). */
  canonFacts: z.array(LabeledFactSchema),
  /** Optional voice calibration exemplars. */
  goodSentences: z.array(z.string()).optional(),
  badSentences: z.array(z.string()).optional(),
});
export type EvalLabel = z.infer<typeof EvalLabelSchema>;

export async function readEvalLabel(path: string): Promise<EvalLabel> {
  return EvalLabelSchema.parse(JSON.parse(await Bun.file(path).text()));
}
