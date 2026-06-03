import type { AudioManifest } from "../types.ts";
import { DEFAULT_OUT_DIR } from "../distill/store.ts";

export { DEFAULT_OUT_DIR } from "../distill/store.ts";

/** Directory holding a session's per-turn clips, e.g. out/<id>/. */
export function clipsDir(sessionId: string, outDir: string = DEFAULT_OUT_DIR): string {
  return `${outDir}/${sessionId}`;
}

/** Path to a session's audio manifest. */
export function manifestPath(sessionId: string, outDir: string = DEFAULT_OUT_DIR): string {
  return `${outDir}/${sessionId}.audio.json`;
}

/** Write the audio manifest as pretty JSON. Returns the path written. */
export async function writeManifest(
  manifest: AudioManifest,
  outDir: string = DEFAULT_OUT_DIR,
): Promise<string> {
  const path = manifestPath(manifest.sessionId, outDir);
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return path;
}

/** Read a cached manifest, or null if absent. */
export async function readManifest(
  sessionId: string,
  outDir: string = DEFAULT_OUT_DIR,
): Promise<AudioManifest | null> {
  const file = Bun.file(manifestPath(sessionId, outDir));
  if (!(await file.exists())) return null;
  return (await file.json()) as AudioManifest;
}
