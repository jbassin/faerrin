// A whisperx-aligned transcript segment. The Python transcribe step emits arrays
// of these per player track; the orchestrator time-merges them into one script.
// `words` is opaque to the orchestrator (passed through untouched). `user` is the
// raw recording user id, tagged on during the merge (resolved to a display name
// downstream by shared-content's roster).
export interface Segment {
  start: number
  end: number
  text: string
  words?: unknown
  user?: string
}
