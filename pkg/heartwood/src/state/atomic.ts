import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Atomic file write: write a sibling .tmp then rename(), so a crash never leaves a
// partially-written state file. Salvaged convention from the old pipeline (ledger,
// wiki index). Creates parent directories as needed. node:fs (not Bun.write) so it
// runs under both runtimes — the review app writes provenance under Node.
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}
