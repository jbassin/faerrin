// Matches "000123\tSpeaker Name: rest of line"
const LINE_RE = /^\d{6}\t([^:]+):\s/;

export interface SpeakerLine {
  line: number;    // 1-based transcript line number
  speaker: string; // e.g. "Gamemaster", "Argyle", "Johnny"
}

/**
 * Parse speaker prefixes from raw transcript text.
 * Lines that don't match the prefix pattern are skipped (blank lines, etc.).
 */
export function parseSpeakers(text: string): SpeakerLine[] {
  const out: SpeakerLine[] = [];
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(LINE_RE);
    if (m) out.push({ line: i + 1, speaker: m[1]!.trim() });
  }
  return out;
}

/**
 * Return the set of distinct speaker names present in [startLine, endLine] inclusive (1-based).
 */
export function speakersInRange(
  speakerLines: SpeakerLine[],
  startLine: number,
  endLine: number,
): Set<string> {
  const out = new Set<string>();
  for (const { line, speaker } of speakerLines) {
    if (line >= startLine && line <= endLine) out.add(speaker);
  }
  return out;
}

/**
 * True if "Gamemaster" appears as a speaker in [startLine, endLine].
 */
export function gmPresent(
  speakerLines: SpeakerLine[],
  startLine: number,
  endLine: number,
): boolean {
  return speakersInRange(speakerLines, startLine, endLine).has('Gamemaster');
}
