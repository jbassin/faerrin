// Core pipeline types (spec §5, §7). The mined Claim is the spine: every claim is
// transcript-cited (AC-3) and carries an epistemic modality (AC-5) so player guesses and
// in-character fiction are never silently treated as established canon.

import { z } from 'zod';

/** Epistemic status of a claim (spec §5 glossary, AC-5, D-10). */
export const MODALITIES = [
  'gm-stated',           // canon: the GM asserted it as world fact
  'player-speculation',  // a player's guess — not canon
  'in-character-fiction', // spoken in-character (may be a lie/legend) — attributed, not bare fact (D-10)
  'uncertain',           // genuinely ambiguous
  'noise',               // out-of-character banter / not world content
] as const;
export type Modality = (typeof MODALITIES)[number];

/** Modalities that may seed canon proposals without explicit promotion (spec AC-5). */
export const CANON_MODALITIES: readonly Modality[] = ['gm-stated'];

export function isCanonModality(m: Modality): boolean {
  return CANON_MODALITIES.includes(m);
}

/** A citation into a transcript. Line ids are per-file, so (transcript, line) is the unit (C8). */
export const CitationSchema = z.object({
  transcript: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  /** Every claim must cite at least one transcript span (AC-3). */
  citations: z.array(CitationSchema).min(1),
  speaker: z.string(),
  role: z.enum(['gm', 'player', 'unknown']),
  modality: z.enum(MODALITIES),
  /** Raw entity mentions, pre-resolution; resolve.ts maps these to canonical entity ids (AC-20). */
  entitySurfaceForms: z.array(z.string()),
});
export type Claim = z.infer<typeof ClaimSchema>;
