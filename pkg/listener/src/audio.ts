import { run } from "./exec.ts"

// Mix the per-player tracks into one mp3, padded to the longest track. Replaces
// the original pydub overlay with a direct ffmpeg `amix` (normalize=0 preserves
// per-track levels, matching pydub's summing overlay rather than averaging).
// Only the merged audio is served to listeners; exact sample parity isn't
// required (only the transcript is parity-gated).
export function mergeAudio(inputs: string[], outPath: string): void {
  if (inputs.length === 0) throw new Error("mergeAudio: no input tracks")

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs.flatMap((f) => ["-i", f]),
    "-filter_complex",
    `amix=inputs=${inputs.length}:duration=longest:normalize=0`,
    "-y",
    outPath,
  ]
  run("ffmpeg", args)
}
