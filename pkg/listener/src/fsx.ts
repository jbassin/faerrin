import fs from "node:fs"

// "Atomic appearance": write to a sibling .tmp then rename() (atomic on one
// filesystem). The destination only ever appears whole, so an `exists()` check
// is a trustworthy "this stage is done" signal — a crash mid-write leaves a
// *.tmp that the skip logic ignores, and the stage cleanly re-runs.
export function writeAtomic(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, filePath)
}
