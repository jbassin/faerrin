import type { Script } from "../types.ts";
import { DEFAULT_OUT_DIR } from "../distill/store.ts";
import { parseScript } from "./parse.ts";

export { DEFAULT_OUT_DIR } from "../distill/store.ts";

/** Path to a session's script artifact. */
export function scriptPath(sessionId: string, outDir: string = DEFAULT_OUT_DIR): string {
  return `${outDir}/${sessionId}.script.json`;
}

/** Write a script to disk as pretty JSON. Returns the path written. */
export async function writeScript(
  script: Script,
  outDir: string = DEFAULT_OUT_DIR,
): Promise<string> {
  const path = scriptPath(script.sessionId, outDir);
  await Bun.write(path, `${JSON.stringify(script, null, 2)}\n`);
  return path;
}

/** Read a cached script, or null if absent. Re-validates via parseScript. */
export async function readScript(
  sessionId: string,
  outDir: string = DEFAULT_OUT_DIR,
): Promise<Script | null> {
  const file = Bun.file(scriptPath(sessionId, outDir));
  if (!(await file.exists())) return null;
  return parseScript(sessionId, await file.json());
}
