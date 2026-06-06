import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Atomic file write: write a unique sibling .tmp then rename(), so a crash never leaves
// a partially-written state file. Salvaged convention from the old pipeline (ledger,
// wiki index). Creates parent directories as needed. node:fs (not Bun.write) so it
// runs under both runtimes — the review app writes provenance under Node. The tmp name
// is unique so two concurrent writes to the same target (e.g. a double-fired POST) don't
// race on one .tmp.
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // globalThis.crypto (Web Crypto) — available in Node 19+, Bun, and browsers — so no
  // `node:crypto` import that Vite would externalize into the client bundle.
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}
