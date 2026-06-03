export interface ChunkOptions {
  windowLines?: number;   // default 400
  overlapLines?: number;  // default 40
}

export interface Window {
  index: number;          // 0-based
  startLine: number;      // 1-based, inclusive
  endLine: number;        // 1-based, inclusive
  text: string;           // joined lines including their on-disk "000123\t…" prefix
}

export interface ChunkResult {
  totalLines: number;
  windows: Window[];
}

const DEFAULT_WINDOW_LINES = 400;
const DEFAULT_OVERLAP_LINES = 40;

export function chunkTranscript(text: string, opts: ChunkOptions = {}): ChunkResult {
  const windowLines  = opts.windowLines  ?? DEFAULT_WINDOW_LINES;
  const overlapLines = opts.overlapLines ?? DEFAULT_OVERLAP_LINES;

  if (windowLines <= 0) {
    throw new Error(`windowLines must be positive (got ${windowLines})`);
  }
  if (overlapLines < 0) {
    throw new Error(`overlapLines must be non-negative (got ${overlapLines})`);
  }
  if (overlapLines >= windowLines) {
    throw new Error(`overlapLines (${overlapLines}) must be < windowLines (${windowLines})`);
  }

  const lines = text.split('\n');
  // Drop a trailing empty line caused by a final newline so totalLines matches a human count.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const totalLines = lines.length;

  if (totalLines === 0) return { totalLines: 0, windows: [] };

  const stride = windowLines - overlapLines;
  const windows: Window[] = [];
  let start = 1;
  let index = 0;
  while (start <= totalLines) {
    const end = Math.min(start + windowLines - 1, totalLines);
    windows.push({
      index,
      startLine: start,
      endLine: end,
      text: lines.slice(start - 1, end).join('\n'),
    });
    if (end === totalLines) break;
    start += stride;
    index += 1;
  }

  return { totalLines, windows };
}
