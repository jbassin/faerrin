import { sha256Hex } from '../wiki/hash';

export interface TranscriptFile {
  filename: string;       // e.g. "000.through-a-song-darkly.2025-8-28.txt"
  campaignId: number;     // 0
  campaignName: string;   // "through-a-song-darkly"
  sessionDate: string;    // "2025-08-28" — ISO-normalized for stable sort
  isMain: boolean;        // campaignId < 100
  contentHash: string;    // sha256 hex of file bytes
  byteLength: number;
}

export interface SkippedFile {
  filename: string;
  reason: string;
}

export interface DiscoveryResult {
  files: TranscriptFile[];     // sorted by (campaignId, sessionDate)
  skipped: SkippedFile[];
}

const FILENAME_RE = /^(\d+)\.([^.]+)\.(\d{4})-(\d{1,2})-(\d{1,2})\.txt$/;

export function parseFilename(filename: string): Omit<TranscriptFile, 'contentHash' | 'byteLength'> | null {
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

export async function discoverTranscripts(transcriptsDir: string): Promise<DiscoveryResult> {
  const glob = new Bun.Glob('*.txt');
  const names: string[] = [];
  for await (const n of glob.scan({ cwd: transcriptsDir, absolute: false })) names.push(n);
  names.sort();

  const files: TranscriptFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const name of names) {
    const parsed = parseFilename(name);
    if (!parsed) {
      skipped.push({ filename: name, reason: 'filename does not match <id>.<name>.<YYYY-M-D>.txt' });
      continue;
    }
    const file = Bun.file(`${transcriptsDir}/${name}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    files.push({
      ...parsed,
      contentHash: sha256Hex(bytes),
      byteLength: bytes.byteLength,
    });
  }

  files.sort((a, b) =>
    a.campaignId - b.campaignId ||
    a.sessionDate.localeCompare(b.sessionDate),
  );

  return { files, skipped };
}
