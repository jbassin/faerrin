import { run } from "./exec.ts"

// Invoke the Python whisper CLI for a whole session at once (model loads once and
// is reused across tracks). Writes `<outDir>/<stem>.json` per input track. Paths
// are passed absolute, so the subprocess cwd (pythonDir, for uv) doesn't matter.
export function transcribe(pythonDir: string, outDir: string, tracks: string[]): void {
  if (tracks.length === 0) return
  run("uv", ["run", "transcribe.py", outDir, ...tracks], { cwd: pythonDir })
}
