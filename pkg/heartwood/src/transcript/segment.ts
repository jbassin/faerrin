import { z } from 'zod';
import { complete as defaultComplete } from '../llm';
import { chunkTranscript, type Window } from './chunk';

export const LABELS = ['ooc', 'recap', 'ic', 'rules', 'combat', 'mixed'] as const;
export type Label = (typeof LABELS)[number];

export const CONFIDENCES = ['high', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

const cap = (max: number) =>
  z.string().transform((s) => {
    if (s.length <= max) return s;
    console.warn(`segment: truncating oneLineSummary (${s.length} → ${max} chars)`);
    return s.slice(0, max - 1) + '…';
  });

const RawSegmentSchema = z.object({
  startLine:      z.number().int().positive(),
  endLine:        z.number().int().positive(),
  label:          z.enum(LABELS),
  confidence:     z.enum(CONFIDENCES),
  oneLineSummary: cap(200),
});

const WindowOutputSchema = z.object({
  segments: z.array(RawSegmentSchema).min(1),
});

export type RawSegment = z.infer<typeof RawSegmentSchema>;
export interface Segment extends RawSegment {}

const SEGMENT_SYSTEM_PROMPT = [
  'You are segmenting Pathfinder 2e tabletop campaign session transcripts.',
  'Each window of the transcript is given to you with line numbers (the 6-digit prefix is the absolute line number in the transcript).',
  '',
  'Label every line. Output one or more contiguous segments that, together, cover EXACTLY the line range you were given — no gaps, no overlaps, no lines outside the window.',
  '',
  'Labels:',
  '- ooc:   out-of-character chatter — players discussing real-world things, technical issues, social banter unrelated to the game.',
  '- recap: a player or GM recounting events from a previous session. Usually near the start.',
  '- ic:    in-character play — the GM narrating the world, players speaking or acting as their characters, action resolution.',
  '- rules:  rules discussion, dice mechanics, build/character-sheet questions, archetype lookups. Brief asks ("nat 20?", "what\'s my AC?") inside IC play are still IC; only label `rules` when the conversation pauses on mechanics.',
  '- combat: an active combat encounter — initiative, attack rolls, damage, HP tracking, tactical movement, spell targeting. Ends when the GM signals the encounter is over. Brief combat interjections inside IC narration are still IC; only label `combat` when the transcript is predominantly mechanical fight resolution.',
  '- mixed: the range genuinely interleaves two or more of the above and cannot be cleanly split. Use sparingly — prefer splitting into smaller single-label segments when possible.',
  '',
  'Confidence:',
  '- high: the boundaries and label are obvious from the text.',
  '- low:  you are uncertain — typically near a transition, or when OOC chatter intrudes briefly on IC play.',
  '',
  'For each segment emit a `oneLineSummary` describing what happens in that range.',
  'KEEP IT SHORT. Aim for 80–120 characters, hard cap 200. Anything over 200 is truncated.',
  'Write a noun phrase, not a full sentence. Drop articles ("the", "a") where possible. Name the people/places that matter; skip filler.',
  'Examples of well-sized summaries:',
  '- "players argue about Discord crashes and Windows update annoyances" (66 chars)',
  '- "Johnny recaps last session\'s rooftop investigation and the Embercall lead" (74 chars)',
  '- "party fights augers in the sewer, recovers Flynn\'s body, returns to Sin and Tonic" (82 chars)',
  '',
  'IMPORTANT:',
  '- Use the absolute line numbers shown in the 6-digit prefixes.',
  '- Your segments must be contiguous and ordered. The first segment\'s startLine must equal the window\'s first line. The last segment\'s endLine must equal the window\'s last line.',
  '- NEVER invent labels outside the five above. NEVER emit segments outside the window range.',
  '- `oneLineSummary` MUST be at most 200 characters. Aim well under that. Be terse.',
].join('\n');

const REFINE_SYSTEM_PROMPT = [
  'You are re-segmenting a portion of a Pathfinder 2e campaign transcript that was initially labeled `mixed` (ambiguous between two or more segment types).',
  'Your job is to commit to a single clear label for each contiguous block of lines.',
  '',
  'Each window contains lines with a 6-digit absolute line-number prefix.',
  'Assign every line to exactly one of these five labels:',
  '- ooc:    out-of-character chatter — real-world topics, technical issues, banter unrelated to the game.',
  '- recap:  a player or GM recounting events from a previous session.',
  '- ic:     in-character play — GM narration, player character speech, action resolution.',
  '- rules:  rules discussion, mechanics lookups, character-build questions.',
  '- combat: active combat encounter — initiative, attack rolls, damage, HP tracking, tactical movement. Label `combat` only when the transcript is predominantly mechanical fight resolution; brief interjections inside IC narration are still `ic`.',
  '',
  'You MUST NOT use the `mixed` label. If a block is ambiguous, pick the dominant label.',
  '',
  'Output one or more contiguous segments that together cover EXACTLY the line range given — no gaps, no overlaps, no lines outside the window.',
  'Use the absolute line numbers shown in the 6-digit prefixes.',
  'For each segment emit a short `oneLineSummary` (aim 80–120 chars, hard cap 200). Confidence `high` unless genuinely uncertain.',
].join('\n');

export interface SegmentWindowOptions {
  model: string;
  transcript: string;
  completeFn?: typeof defaultComplete;
  systemPrompt?: string;
}

export async function segmentWindow(
  window: Window,
  opts: SegmentWindowOptions,
): Promise<RawSegment[]> {
  const fn = opts.completeFn ?? defaultComplete;
  const result = await fn({
    stage: 'segment',
    transcript: opts.transcript,
    model: opts.model,
    cached: opts.systemPrompt ?? SEGMENT_SYSTEM_PROMPT,
    user: [
      `Window covers lines ${window.startLine}-${window.endLine}.`,
      'Transcript window:',
      window.text,
    ].join('\n\n'),
    schema: WindowOutputSchema,
    maxTokens: 4096,
  });
  return normalizeWindow(result.value.segments, window);
}

export function normalizeWindow(rawSegments: RawSegment[], window: Window): RawSegment[] {
  // 1. Clamp to window bounds, drop invalid (start > end after clamping).
  const clamped: RawSegment[] = [];
  for (const s of rawSegments) {
    const start = Math.max(s.startLine, window.startLine);
    const end   = Math.min(s.endLine,   window.endLine);
    if (start > end) continue;
    clamped.push({ ...s, startLine: start, endLine: end });
  }
  if (clamped.length === 0) {
    throw new Error(
      `segmenter produced no usable segments for window ${window.index} [${window.startLine}-${window.endLine}]`,
    );
  }

  // 2. Sort by startLine.
  clamped.sort((a, b) => a.startLine - b.startLine);

  // 3. Walk; close gaps and trim overlaps so output is strictly contiguous.
  const out: RawSegment[] = [];
  for (const raw of clamped) {
    const s = { ...raw };
    if (out.length === 0) {
      if (s.startLine > window.startLine) {
        console.warn(
          `segment(window ${window.index}): stretching first segment start ${s.startLine}→${window.startLine}`,
        );
        s.startLine = window.startLine;
      }
      out.push(s);
      continue;
    }
    const prev = out[out.length - 1]!;
    if (s.startLine <= prev.endLine) {
      const newStart = prev.endLine + 1;
      if (newStart > s.endLine) {
        console.warn(
          `segment(window ${window.index}): dropping subsumed segment ${s.startLine}-${s.endLine}`,
        );
        continue;
      }
      console.warn(
        `segment(window ${window.index}): truncating overlapping start ${s.startLine}→${newStart}`,
      );
      s.startLine = newStart;
    } else if (s.startLine > prev.endLine + 1) {
      console.warn(
        `segment(window ${window.index}): snap-filling gap, extending prev endLine ${prev.endLine}→${s.startLine - 1}`,
      );
      prev.endLine = s.startLine - 1;
    }
    out.push(s);
  }

  // 4. Stretch last to window.endLine if the model nudged in.
  const last = out[out.length - 1]!;
  if (last.endLine < window.endLine) {
    console.warn(
      `segment(window ${window.index}): stretching last segment end ${last.endLine}→${window.endLine}`,
    );
    last.endLine = window.endLine;
  }

  // 5. Sanity-check the result covers [window.startLine, window.endLine] exactly.
  if (out[0]!.startLine !== window.startLine) {
    throw new Error(
      `normalized window ${window.index}: first startLine ${out[0]!.startLine} != ${window.startLine}`,
    );
  }
  if (out[out.length - 1]!.endLine !== window.endLine) {
    throw new Error(
      `normalized window ${window.index}: last endLine ${out[out.length - 1]!.endLine} != ${window.endLine}`,
    );
  }
  return out;
}

interface Contribution {
  window: Window;
  seg: RawSegment;
}

function centerOf(w: Window): number {
  return (w.startLine + w.endLine) / 2;
}

function pickContribution(line: number, contributions: Contribution[]): RawSegment {
  if (contributions.length === 1) return contributions[0]!.seg;
  // High confidence beats low when they disagree on which contributors to consider.
  const highs = contributions.filter((c) => c.seg.confidence === 'high');
  const pool = highs.length > 0 && highs.length < contributions.length ? highs : contributions;
  // Center-wins; lower window index breaks an exact distance tie.
  let best = pool[0]!;
  let bestDist = Math.abs(line - centerOf(best.window));
  for (let i = 1; i < pool.length; i++) {
    const c = pool[i]!;
    const d = Math.abs(line - centerOf(c.window));
    if (d < bestDist || (d === bestDist && c.window.index < best.window.index)) {
      best = c;
      bestDist = d;
    }
  }
  return best.seg;
}

export interface WindowOutput {
  window: Window;
  segments: RawSegment[];
}

export function stitchSegments(windowOutputs: WindowOutput[], totalLines: number): Segment[] {
  if (totalLines <= 0) return [];

  // assignment[L] = list of (window, segment) covering line L.
  const assignment: Contribution[][] = Array.from({ length: totalLines + 1 }, () => []);
  for (const { window, segments } of windowOutputs) {
    for (const seg of segments) {
      const lo = Math.max(1, seg.startLine);
      const hi = Math.min(totalLines, seg.endLine);
      for (let L = lo; L <= hi; L++) {
        assignment[L]!.push({ window, seg });
      }
    }
  }

  // Resolve a label/conf/summary triple per line.
  const winner: (RawSegment | null)[] = new Array(totalLines + 1).fill(null);
  for (let L = 1; L <= totalLines; L++) {
    const contribs = assignment[L]!;
    if (contribs.length === 0) {
      throw new Error(`stitch: line ${L} has no segment coverage`);
    }
    winner[L] = pickContribution(L, contribs);
  }

  // Merge adjacent lines that share (label, confidence, summary) into segments.
  const out: Segment[] = [];
  for (let L = 1; L <= totalLines; L++) {
    const w = winner[L]!;
    const last = out[out.length - 1];
    if (
      last &&
      last.label === w.label &&
      last.confidence === w.confidence &&
      last.oneLineSummary === w.oneLineSummary &&
      last.endLine === L - 1
    ) {
      last.endLine = L;
    } else {
      out.push({
        startLine: L,
        endLine: L,
        label: w.label,
        confidence: w.confidence,
        oneLineSummary: w.oneLineSummary,
      });
    }
  }

  // Validate full coverage.
  if (out.length === 0 || out[0]!.startLine !== 1 || out[out.length - 1]!.endLine !== totalLines) {
    throw new Error(`stitch: final coverage doesn't span [1-${totalLines}]`);
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.startLine !== out[i - 1]!.endLine + 1) {
      throw new Error(`stitch: gap or overlap between segments ${i - 1} and ${i}`);
    }
  }

  return out;
}

export interface SegmentTranscriptOptions {
  model: string;
  transcript: string;
  windowLines?: number;
  overlapLines?: number;
  completeFn?: typeof defaultComplete;
}

export interface SegmentTranscriptResult {
  segments: Segment[];
  totalLines: number;
  windowCount: number;
  refinedCount: number;
}

// Stitches windows whose segments use absolute line numbers. Remaps to
// relative coordinates for stitchSegments, then remaps back.
function stitchAbsoluteSegments(
  windowOutputs: WindowOutput[],
  absStart: number,
  absEnd: number,
): Segment[] {
  const totalLines = absEnd - absStart + 1;
  const relOutputs: WindowOutput[] = windowOutputs.map((wo) => ({
    window: {
      ...wo.window,
      startLine: wo.window.startLine - absStart + 1,
      endLine:   wo.window.endLine   - absStart + 1,
    },
    segments: wo.segments.map((s) => ({
      ...s,
      startLine: s.startLine - absStart + 1,
      endLine:   s.endLine   - absStart + 1,
    })),
  }));
  return stitchSegments(relOutputs, totalLines).map((s) => ({
    ...s,
    startLine: s.startLine + absStart - 1,
    endLine:   s.endLine   + absStart - 1,
  }));
}

interface RefineOpts {
  model: string;
  transcript: string;
  completeFn?: typeof defaultComplete;
}

async function refineMixedSegments(
  segments: Segment[],
  transcriptLines: string[],
  opts: RefineOpts,
): Promise<Segment[]> {
  const result: Segment[] = [];
  for (const seg of segments) {
    if (seg.label !== 'mixed') {
      result.push(seg);
      continue;
    }
    // Chunk this mixed segment into small windows using absolute line numbers.
    const sliceText = transcriptLines.slice(seg.startLine - 1, seg.endLine).join('\n');
    const { windows: relWindows } = chunkTranscript(sliceText, { windowLines: 80, overlapLines: 10 });
    // Remap window bounds from slice-relative to absolute.
    const windows: Window[] = relWindows.map((w) => ({
      ...w,
      startLine: w.startLine + seg.startLine - 1,
      endLine:   w.endLine   + seg.startLine - 1,
      text: transcriptLines
        .slice(w.startLine + seg.startLine - 2, w.endLine + seg.startLine - 1)
        .join('\n'),
    }));
    const windowOutputs: WindowOutput[] = [];
    for (const w of windows) {
      const refined = await segmentWindow(w, {
        model:        opts.model,
        transcript:   opts.transcript,
        completeFn:   opts.completeFn,
        systemPrompt: REFINE_SYSTEM_PROMPT,
      });
      windowOutputs.push({ window: w, segments: refined });
    }
    result.push(...stitchAbsoluteSegments(windowOutputs, seg.startLine, seg.endLine));
  }
  return result;
}

export async function segmentTranscript(
  text: string,
  opts: SegmentTranscriptOptions,
): Promise<SegmentTranscriptResult> {
  const { windows, totalLines } = chunkTranscript(text, {
    windowLines:  opts.windowLines,
    overlapLines: opts.overlapLines,
  });
  const outputs: WindowOutput[] = [];
  for (const w of windows) {
    const segments = await segmentWindow(w, {
      model:      opts.model,
      transcript: opts.transcript,
      completeFn: opts.completeFn,
    });
    outputs.push({ window: w, segments });
  }
  const stitched = stitchSegments(outputs, totalLines);
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  let final = stitched;
  let refinedCount = 0;
  for (let pass = 0; pass < 3; pass++) {
    const remaining = final.filter((s) => s.label === 'mixed');
    if (remaining.length === 0) break;
    refinedCount += remaining.length;
    final = await refineMixedSegments(final, lines, {
      model:      opts.model,
      transcript: opts.transcript,
      completeFn: opts.completeFn,
    });
  }
  return {
    segments:     final,
    totalLines,
    windowCount:  windows.length,
    refinedCount,
  };
}
