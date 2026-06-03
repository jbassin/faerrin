/** Escape a path for an ffmpeg concat-demuxer `file '...'` line. */
function esc(path: string): string {
  return path.replace(/'/g, "'\\''");
}

/**
 * Build an ffmpeg concat-demuxer list interleaving clips with silence segments:
 *   file 'clip1'
 *   file 'gap-250'
 *   file 'clip2'
 *   ...
 * `gapMs` has one entry per inter-clip gap (length = clips - 1); `silencePath`
 * maps a gap duration to its pre-generated silence file. Paths should be absolute.
 */
export function buildConcatList(
  clipPaths: string[],
  gapMs: number[],
  silencePath: (ms: number) => string,
): string {
  const lines: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    lines.push(`file '${esc(clipPaths[i]!)}'`);
    if (i < gapMs.length) {
      lines.push(`file '${esc(silencePath(gapMs[i]!))}'`);
    }
  }
  return `${lines.join("\n")}\n`;
}
