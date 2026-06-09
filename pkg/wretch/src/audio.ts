import { run } from "./exec.ts"

// Build the ffmpeg argv for the merge. Kept pure (no I/O) so it's unit-testable
// without ffmpeg on PATH. `-f mp3` is REQUIRED: callers write to an atomic-
// appearance `.tmp` path (write `.tmp` → rename), and ffmpeg infers its output
// muxer from the filename extension — `.tmp` is not a container, so without an
// explicit format ffmpeg aborts with "Unable to find a suitable output format".
export function mergeArgs(inputs: string[], outPath: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs.flatMap((f) => ["-i", f]),
    "-filter_complex",
    `amix=inputs=${inputs.length}:duration=longest:normalize=0`,
    "-f",
    "mp3",
    "-y",
    outPath,
  ]
}

// Mix the per-player tracks into one mp3, padded to the longest track. Replaces
// the original pydub overlay with a direct ffmpeg `amix` (normalize=0 preserves
// per-track levels, matching pydub's summing overlay rather than averaging).
// Only the merged audio is served to listeners; exact sample parity isn't
// required (only the transcript is parity-gated).
export function mergeAudio(inputs: string[], outPath: string): void {
  if (inputs.length === 0) throw new Error("mergeAudio: no input tracks")
  run("ffmpeg", mergeArgs(inputs, outPath))
}
