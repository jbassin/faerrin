import { sha256Hex } from '../wiki/hash';
import { parseFilename, type ParsedFilename } from './filename';

// parseFilename is the pure parser (no I/O) — re-exported here for back-compat.
export { parseFilename };

export interface TranscriptFile extends ParsedFilename {
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
