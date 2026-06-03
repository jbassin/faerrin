import type { ResolvedSpeaker, Session, SpeakerIndex, Turn } from "../types.ts";
import { basename } from "node:path";

/** The arc-scoped slice of a SpeakerIndex: characterName -> ResolvedSpeaker. */
export type ArcSpeakers = Map<string, ResolvedSpeaker>;

/** Matches a transcript line: `NNNNNN\tSpeaker: text`. */
const LINE_RE = /^(\d+)\t([^:]+):\s?(.*)$/;

/** Matches a transcript filename: `NNN.arc-slug.YYYY-M-D.txt`. */
const FILENAME_RE = /^(\d+)\.(.+)\.(\d{4}-\d{1,2}-\d{1,2})\.txt$/;

export interface ParsedFilename {
  arcNumber: string;
  arc: string;
  date: string;
  id: string;
}

/**
 * Convert a `YYYY-M-D` filename date (no zero-padding) into a sortable integer
 * `YYYYMMDD`. Lexical string sort is wrong here because "11-4" < "11-11" as
 * text but not as a date.
 */
export function dateSortKey(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (y ?? 0) * 1_00_00 + (m ?? 0) * 1_00 + (d ?? 0);
}

/** Parse `105.observatory-slipped.2026-4-27.txt` into its components. */
export function parseFilename(filePath: string): ParsedFilename | null {
  const name = basename(filePath);
  const m = FILENAME_RE.exec(name);
  if (!m) return null;
  const [, arcNumber, arc, date] = m as unknown as [string, string, string, string];
  return { arcNumber, arc, date, id: name.replace(/\.txt$/, "") };
}

export interface ParseTranscriptResult {
  turns: Turn[];
  /** 1-based line indices of non-empty lines that did not match LINE_RE. */
  unparsed: number[];
}

/**
 * Parse transcript text into turns, resolving each speaker against the
 * arc-scoped slice of the speaker index. Empty lines are skipped; non-empty
 * lines that don't match are reported in `unparsed` rather than silently lost.
 */
export function parseTranscript(
  text: string,
  speakersForArc?: ArcSpeakers,
): ParseTranscriptResult {
  const turns: Turn[] = [];
  const unparsed: number[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;

    const m = LINE_RE.exec(raw);
    if (!m) {
      unparsed.push(i + 1);
      continue;
    }

    const [, lineNo, speaker, body] = m as unknown as [string, string, string, string];
    const resolved = speakersForArc?.get(speaker);

    turns.push({
      line: Number(lineNo),
      speaker,
      text: body.trimEnd(),
      player: resolved?.player,
      role: resolved?.role,
    });
  }

  return { turns, unparsed };
}

/**
 * Load one transcript file into a Session, applying the speaker index.
 * Returns null if the filename doesn't match the expected pattern.
 */
export async function loadSession(
  filePath: string,
  speakerIndex: SpeakerIndex,
  arcTitles: Map<string, string>,
  mainArcs: Set<string>,
): Promise<Session | null> {
  const parsed = parseFilename(filePath);
  if (!parsed) return null;

  const text = await Bun.file(filePath).text();
  const { turns } = parseTranscript(text, speakerIndex.get(parsed.arc));

  return {
    id: parsed.id,
    arc: parsed.arc,
    arcTitle: arcTitles.get(parsed.arc),
    isMain: mainArcs.has(parsed.arc),
    date: parsed.date,
    path: filePath,
    turns,
  };
}
