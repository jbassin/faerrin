import type { SessionDigest } from "../types.ts";
import { parseDigest } from "./parse.ts";

/** Default directory for stage artifacts (gitignored). */
export const DEFAULT_OUT_DIR = "out";

/** Path to a session's digest artifact. */
export function digestPath(sessionId: string, outDir: string = DEFAULT_OUT_DIR): string {
  return `${outDir}/${sessionId}.digest.json`;
}

/** Write a digest to disk as pretty JSON. Returns the path written. */
export async function writeDigest(
  digest: SessionDigest,
  outDir: string = DEFAULT_OUT_DIR,
): Promise<string> {
  const path = digestPath(digest.sessionId, outDir);
  await Bun.write(path, `${JSON.stringify(digest, null, 2)}\n`);
  return path;
}

/**
 * Read a cached digest, or null if absent. The file is re-validated through
 * parseDigest, so a corrupt or hand-edited artifact fails loudly rather than
 * flowing malformed data into Stage 3.
 */
export async function readDigest(
  sessionId: string,
  outDir: string = DEFAULT_OUT_DIR,
): Promise<SessionDigest | null> {
  const file = Bun.file(digestPath(sessionId, outDir));
  if (!(await file.exists())) return null;
  return parseDigest(sessionId, await file.json());
}
