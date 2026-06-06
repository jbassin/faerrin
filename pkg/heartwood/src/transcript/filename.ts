// Pure transcript-filename parsing — NO Bun/Node I/O, so it is safe to import from
// any runtime (the review app's Node server fns reach this via state/identity.ts).
// Kept separate from discover.ts precisely because discover.ts uses Bun.Glob/Bun.file
// for the actual filesystem scan; importing it under Node loads fine but is a foot-gun.

export interface ParsedFilename {
  filename: string;       // e.g. "000.through-a-song-darkly.2025-8-28.txt"
  campaignId: number;     // 0
  campaignName: string;   // "through-a-song-darkly" (the arc slug)
  sessionDate: string;    // "2025-08-28" — ISO-normalized for stable sort
  isMain: boolean;        // campaignId < 100
}

const FILENAME_RE = /^(\d+)\.([^.]+)\.(\d{4})-(\d{1,2})-(\d{1,2})\.txt$/;

export function parseFilename(filename: string): ParsedFilename | null {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  const campaignId = Number(m[1]);
  const campaignName = m[2]!;
  const year = m[3]!;
  const month = m[4]!.padStart(2, '0');
  const day = m[5]!.padStart(2, '0');
  return {
    filename,
    campaignId,
    campaignName,
    sessionDate: `${year}-${month}-${day}`,
    isMain: campaignId < 100,
  };
}
