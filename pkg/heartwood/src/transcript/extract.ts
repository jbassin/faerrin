import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import { chunkTranscript } from './chunk';
import { parseSpeakers, speakersInRange, gmPresent, type SpeakerLine } from './speakers';
import type { Segment } from './segment';
import { filterByWorthiness } from './worthiness';

// ---- Extraction units ----

export const EXTRACT_LABELS = ['ic', 'recap', 'mixed'] as const;
export type ExtractLabel = (typeof EXTRACT_LABELS)[number];

export interface ExtractionUnit {
  sourceSegmentStartLine: number;  // startLine of the parent segment
  label: ExtractLabel;
  startLine: number;               // absolute, 1-based, inclusive
  endLine: number;                 // absolute, 1-based, inclusive
  text: string;                    // raw transcript lines including "000123\t..." prefix
  isFirstWindowOfSegment: boolean;
  overlapLines: number;            // leading overlap lines from the prior window (0 for first)
}

export interface BuildUnitsOptions {
  windowLines?: number;   // default 400
  overlapLines?: number;  // default 40
}

/**
 * Build extraction units from a segments file + the full transcript text.
 * Only ic/recap/mixed segments are included. Long segments are chunked;
 * short ones produce a single unit.
 */
export function buildExtractionUnits(
  transcriptLines: string[],
  segments: Segment[],
  opts: BuildUnitsOptions = {},
): ExtractionUnit[] {
  const windowLines  = opts.windowLines  ?? 400;
  const overlapLines = opts.overlapLines ?? 40;
  const units: ExtractionUnit[] = [];

  for (const seg of segments) {
    if (!(EXTRACT_LABELS as readonly string[]).includes(seg.label)) continue;
    const label = seg.label as ExtractLabel;

    // Slice the segment's raw lines (0-indexed array, seg is 1-based).
    const slice = transcriptLines.slice(seg.startLine - 1, seg.endLine);
    const sliceText = slice.join('\n');

    const { windows } = chunkTranscript(sliceText, { windowLines, overlapLines });

    for (let wi = 0; wi < windows.length; wi++) {
      const w = windows[wi]!;
      // Remap from slice-relative 1-based to absolute 1-based.
      const absStart = seg.startLine + w.startLine - 1;
      const absEnd   = seg.startLine + w.endLine   - 1;
      const actualOverlap = wi === 0 ? 0 : overlapLines;

      units.push({
        sourceSegmentStartLine: seg.startLine,
        label,
        startLine: absStart,
        endLine: absEnd,
        text: w.text,
        isFirstWindowOfSegment: wi === 0,
        overlapLines: actualOverlap,
      });
    }
  }

  return units;
}

// ---- Claim schema ----
//
// The LLM-facing schema uses flat lineStart/lineEnd fields (no tuple) to avoid
// the more complex JSON Schema that z.tuple() generates, which can cause models
// to JSON-encode the claims array as a string.

const LlmClaimSchema = z.object({
  claim:      z.string().min(1),
  lineStart:  z.number().int().positive(),
  lineEnd:    z.number().int().positive(),
  speaker:    z.string().min(1),
  role:       z.enum(['gm', 'player']),
  confidence: z.enum(['stated', 'inferred', 'speculative']),
  entities:   z.array(z.string()),
});

type LlmClaim = z.infer<typeof LlmClaimSchema>;

const ExtractionOutputSchema = z.object({
  // Preprocess handles models that JSON-encode the array as a string.
  // On parse failure (truncated output) we return [] and log; no silent data loss.
  claims: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      try { return JSON.parse(v); } catch {
        console.warn('extract: claims field was a malformed JSON string — treating as empty');
        return [];
      }
    },
    z.array(LlmClaimSchema),
  ),
});

// Public types used by the rest of the pipeline.
export interface RawClaim {
  claim:      string;
  lines:      [number, number];   // [startLine, endLine], 1-based inclusive
  speaker:    string;
  role:       'gm' | 'player';
  confidence: 'stated' | 'inferred' | 'speculative';
  entities:   string[];
}

export interface EntityResolution {
  original:     string;
  canonical:    string;
  page:         string | null;
  method:       'exact' | 'fuzzy' | 'llm' | 'none';
  suggestAlias: boolean;
}

export interface Claim extends RawClaim {
  sourceSegmentStartLine: number;
  entityResolutions?: EntityResolution[];
}

// ---- Cached system prompt ----

const EXTRACT_SYSTEM_PROMPT = [
  'You are extracting wiki-worthy factual claims from Pathfinder 2e tabletop campaign session transcripts.',
  'The goal is a world wiki — encyclopedia entries for people, places, organizations, and lore.',
  '',
  'Each chunk you receive contains lines in the format:',
  '  000123\\tSpeaker Name: dialogue',
  '',
  'DO extract (wiki-worthy):',
  '- Persistent entity descriptions: physical appearance, notable traits, clothing, mannerisms',
  '- Organizational facts: who runs what, factions, hierarchy, purpose, location',
  '- Named places: what they are, who controls them, physical character',
  '- Lore and world-rules: how magic, technology, or society works in this setting',
  '- Relationships that persist beyond one session: alliances, enmities, employment, family',
  '- Historical events: things that happened before or during the campaign that shape the world',
  '',
  'DO NOT extract (non-wiki):',
  '- Scene blocking: who sat where, what someone produced, where people were standing',
  '- Dice roll outcomes and combat blow-by-blow',
  '- Single-session ephemeral events: "the party went to X", "the GM described Y arriving"',
  '- Dialogue paraphrase: restating what someone said without a persistent world fact',
  '- Transient possessions or resources: "Benny had 3 gold", "the fire extinguisher was red"',
  '- Out-of-character remarks even within IC-labeled segments',
  '- For MIXED segments (should be rare): skip any lines that are clearly out-of-character',
  '',
  'Speaker filter rule:',
  'Extract claims only from lines spoken by the Gamemaster.',
  'Exception: in segments labeled RECAP, player lines are also valid sources because they are recounting established prior-session canon.',
  '',
  'For each wiki-worthy claim emit:',
  '- claim: a single atomic statement in third-person declarative prose',
  '- lineStart: the 6-digit prefix number of the first transcript line supporting this claim',
  '- lineEnd:   the 6-digit prefix number of the last transcript line supporting this claim',
  '  (lineEnd - lineStart must be ≤ 19; if a passage spans more, split into multiple claims)',
  '- speaker: the name of the speaker whose statement is the primary source',
  '  (match exactly how the name appears after the tab character, before the colon)',
  '- role: "gm" if the Gamemaster is the primary source, "player" if a player character is',
  '- confidence:',
  '    "stated"      — GM narrates a world fact directly',
  '    "inferred"    — GM implies something without stating it outright',
  '    "speculative" — player recounts or infers a world fact in a RECAP segment',
  '- entities: array of proper nouns (people, places, organizations, phenomena) mentioned in the claim',
  '',
  'IMPORTANT:',
  '- lineStart and lineEnd must fall within the window range you were given.',
  '- Do not invent claims not supported by the cited lines.',
  '- If no wiki-worthy claims exist in this chunk, emit an empty claims array.',
].join('\n');

// ---- Per-unit extraction ----

export interface ExtractUnitOptions {
  model: string;
  transcript: string;
  completeFn?: typeof defaultComplete;
}

export async function extractUnit(
  unit: ExtractionUnit,
  opts: ExtractUnitOptions,
): Promise<RawClaim[]> {
  const fn = opts.completeFn ?? defaultComplete;
  const label = unit.label === 'mixed'
    ? 'This segment is labeled MIXED — it interleaves in-character and out-of-character content. Extract claims only from clearly in-character or recap portions.'
    : `This segment is labeled ${unit.label.toUpperCase()}.`;

  const result = await fn({
    stage: 'extract',
    transcript: opts.transcript,
    model: opts.model,
    cached: EXTRACT_SYSTEM_PROMPT,
    user: [
      `Transcript chunk: lines ${unit.startLine}–${unit.endLine}. ${label}`,
      unit.text,
    ].join('\n\n'),
    schema: ExtractionOutputSchema,
    maxTokens: 8192,
  });

  return (result.value.claims as LlmClaim[]).map((c): RawClaim => ({
    claim:      c.claim,
    lines:      [c.lineStart, c.lineEnd],
    speaker:    c.speaker,
    role:       c.role,
    confidence: c.confidence,
    entities:   c.entities,
  }));
}

// ---- Repair and validation ----

export interface RepairResult {
  claim: Claim | null;
  repaired: boolean;
  dropReason?: string;
}

export function repairAndValidateClaim(
  raw: RawClaim,
  speakerLines: SpeakerLine[],
  unit: ExtractionUnit,
): RepairResult {
  const [start, end] = raw.lines;

  // 1. Clamp lines to unit's absolute bounds.
  const clampedStart = Math.max(start, unit.startLine);
  const clampedEnd   = Math.min(end,   unit.endLine);
  if (clampedStart > clampedEnd) {
    return {
      claim: null,
      repaired: false,
      dropReason: `lines [${start},${end}] outside unit [${unit.startLine},${unit.endLine}]`,
    };
  }

  // 2. Enforce ≤ 20-line limit.
  if (clampedEnd - clampedStart > 19) {
    return {
      claim: null,
      repaired: false,
      dropReason: `lines span ${clampedEnd - clampedStart + 1} > 20`,
    };
  }

  // 3. Validate speaker appears in the cited range.
  const speakers = speakersInRange(speakerLines, clampedStart, clampedEnd);
  if (!speakers.has(raw.speaker)) {
    return {
      claim: null,
      repaired: false,
      dropReason: `speaker '${raw.speaker}' not found in lines ${clampedStart}–${clampedEnd}`,
    };
  }

  // 4. Recompute role from prefixes (overrides LLM judgment).
  const repairedRole: 'gm' | 'player' = gmPresent(speakerLines, clampedStart, clampedEnd)
    ? 'gm'
    : 'player';

  // 5. Drop player claims from non-recap segments.
  if (repairedRole === 'player' && unit.label !== 'recap') {
    return { claim: null, repaired: false, dropReason: 'player claim in non-recap segment' };
  }

  const repaired = repairedRole !== raw.role || clampedStart !== start || clampedEnd !== end;

  const claim: Claim = {
    ...raw,
    lines: [clampedStart, clampedEnd],
    role: repairedRole,
    sourceSegmentStartLine: unit.sourceSegmentStartLine,
  };

  return { claim, repaired };
}

function isInOverlapZone(claim: Claim, unit: ExtractionUnit): boolean {
  if (unit.isFirstWindowOfSegment) return false;
  return claim.lines[0] < unit.startLine + unit.overlapLines;
}

// ---- Top-level entrypoint ----

export interface ExtractTranscriptOptions {
  model: string;
  transcript: string;
  windowLines?: number;
  overlapLines?: number;
  worthinessModel?: string;
  completeFn?: typeof defaultComplete;
  onChunkComplete?: (unit: ExtractionUnit, rawClaims: RawClaim[], kept: Claim[]) => void;
}

export interface ExtractTranscriptResult {
  claims: Claim[];
  rawClaims: Claim[];        // pre-worthiness-filter claims
  unitCount: number;
  droppedCount: number;
  repairedCount: number;
  filteredCount: number;     // dropped by worthiness filter
}

export async function extractTranscript(
  text: string,
  segments: Segment[],
  opts: ExtractTranscriptOptions,
): Promise<ExtractTranscriptResult> {
  const transcriptLines = text.split('\n');
  if (transcriptLines.length > 0 && transcriptLines[transcriptLines.length - 1] === '') {
    transcriptLines.pop();
  }

  const speakerLines = parseSpeakers(text);
  const units = buildExtractionUnits(transcriptLines, segments, {
    windowLines: opts.windowLines,
    overlapLines: opts.overlapLines,
  });

  const allClaims: Claim[] = [];
  let droppedCount = 0;
  let repairedCount = 0;

  for (const unit of units) {
    const raw = await extractUnit(unit, {
      model:      opts.model,
      transcript: opts.transcript,
      completeFn: opts.completeFn,
    });

    const kept: Claim[] = [];
    for (const r of raw) {
      const { claim, repaired, dropReason } = repairAndValidateClaim(r, speakerLines, unit);
      if (!claim) {
        droppedCount++;
        console.warn(
          `extract(${opts.transcript}): dropping claim "${r.claim.slice(0, 60)}" — ${dropReason}`,
        );
        continue;
      }
      if (isInOverlapZone(claim, unit)) {
        droppedCount++;
        continue;
      }
      if (repaired) repairedCount++;
      kept.push(claim);
    }

    opts.onChunkComplete?.(unit, raw, kept);
    allClaims.push(...kept);
  }

  allClaims.sort((a, b) => a.lines[0] - b.lines[0] || a.lines[1] - b.lines[1]);

  let finalClaims = allClaims;
  let filteredCount = 0;
  if (opts.worthinessModel) {
    const { kept, dropped } = await filterByWorthiness(allClaims, {
      model:      opts.worthinessModel,
      transcript: opts.transcript,
      completeFn: opts.completeFn,
    });
    finalClaims  = kept;
    filteredCount = dropped.length;
  }

  return {
    claims:        finalClaims,
    rawClaims:     allClaims,
    unitCount:     units.length,
    droppedCount,
    repairedCount,
    filteredCount,
  };
}
