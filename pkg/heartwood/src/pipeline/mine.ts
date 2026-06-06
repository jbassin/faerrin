// Mine stage (spec §6.2, AC-3, AC-5). Chunk a transcript, extract durable setting-fact Claims
// (each transcript-cited + modality-tagged), attribute each to a speaker/role from its cited
// lines, and dedup across overlapping windows. Bounded cost: per-window calls, never the whole
// wiki (C1). DI via completeFn for hermetic tests.

import { z } from 'zod';
import { complete, type CompleteArgs, type CompleteResult } from '../llm';
import { config } from '../config';
import { chunkTranscript } from '../transcript/chunk';
import { parseSpeakers } from '../transcript/speakers';
import { normalizeSentence } from '../anchor/anchor';
import { pool } from '../util/pool';
import { MODALITIES, type Claim, type Modality } from './types';
import { SETTING_FACT_SYSTEM } from './prompts';

const MODALITY_NOTE = `\n\nFor EACH fact also classify its modality:
- "gm-stated": the GM affirmed it as world-fact (the default for established setting facts).
- "player-speculation": a player's guess or theory — not yet canon.
- "in-character-fiction": spoken in-character (an NPC's claim that may be a lie/legend) — phrase the fact as attributed ("X claims ...").
- "uncertain": genuinely ambiguous.
Only mine setting facts (per the rules above); use modality to flag how firmly each is established.`;

const MinedFactSchema = z.object({
  statement: z.string().describe('One atomic durable setting fact, in plain prose.'),
  entities: z.array(z.string()).describe('Named entities the fact concerns (people, places, orgs).'),
  startLine: z.number().int().describe('First transcript line number (the NNNNNN prefix) supporting it.'),
  endLine: z.number().int().describe('Last supporting transcript line number.'),
  modality: z.enum(MODALITIES).describe('How firmly the fact is established.'),
});
export const MineChunkSchema = z.object({ facts: z.array(MinedFactSchema) });

export type MineCompleteFn = (
  args: CompleteArgs<typeof MineChunkSchema>,
) => Promise<CompleteResult<typeof MineChunkSchema>>;

export interface MineOptions {
  /** Transcript filename, recorded on each citation (the citation is (transcript, line)). */
  transcriptName: string;
  model?: string;
  concurrency?: number;
  completeFn?: MineCompleteFn;
}

export interface MineResult {
  claims: Claim[];
  windows: number;
  /** Total facts emitted before dedup (overlap windows repeat boundary facts). */
  rawCount: number;
}

function roleFor(speaker: string | undefined, modality: Modality): Claim['role'] {
  if (speaker === 'Gamemaster') return 'gm';
  if (speaker) return 'player';
  if (modality === 'gm-stated') return 'gm';
  if (modality === 'player-speculation' || modality === 'in-character-fiction') return 'player';
  return 'unknown';
}

export async function mine(text: string, opts: MineOptions): Promise<MineResult> {
  const completeFn = opts.completeFn ?? (complete as MineCompleteFn);
  const model = opts.model ?? config().MODEL_MINE;
  const { windows } = chunkTranscript(text);

  // line -> speaker map for attribution.
  const speakerAt = new Map<number, string>();
  for (const s of parseSpeakers(text)) speakerAt.set(s.line, s.speaker);
  const speakerForSpan = (start: number, end: number): string | undefined => {
    for (let ln = start; ln <= end; ln++) { const sp = speakerAt.get(ln); if (sp) return sp; }
    for (let ln = start - 1; ln >= 1; ln--) { const sp = speakerAt.get(ln); if (sp) return sp; } // nearest preceding
    return undefined;
  };

  const perWindow = await pool(windows, opts.concurrency ?? 4, async (w) => {
    const { value } = await completeFn({
      stage: 'mine',
      transcript: opts.transcriptName,
      model,
      cached: SETTING_FACT_SYSTEM + MODALITY_NOTE,
      user: `Transcript lines ${w.startLine}-${w.endLine}:\n\n${w.text}`,
      schema: MineChunkSchema,
      maxTokens: 8192,
    });
    return value.facts;
  });

  // Merge + dedup by normalized statement (overlap windows repeat boundary facts).
  const seen = new Map<string, Claim>();
  let rawCount = 0;
  let counter = 0;
  for (const f of perWindow.flat()) {
    rawCount++;
    const key = normalizeSentence(f.statement);
    if (!key || seen.has(key)) continue;
    const speaker = speakerForSpan(f.startLine, f.endLine);
    seen.set(key, {
      id: `c${String(++counter).padStart(3, '0')}`,
      text: f.statement.trim(),
      citations: [{ transcript: opts.transcriptName, start: f.startLine, end: f.endLine }],
      speaker: speaker ?? 'unknown',
      role: roleFor(speaker, f.modality),
      modality: f.modality,
      entitySurfaceForms: f.entities,
    });
  }

  return { claims: [...seen.values()], windows: windows.length, rawCount };
}
