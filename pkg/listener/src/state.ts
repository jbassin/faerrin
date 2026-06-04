import fs from "node:fs"
import path from "node:path"

// Tracks which Craig zips have been processed. Replaces the original Python
// `shelve` pickle (data.pkl) with a plain JSON file — the state is near-disposable
// (processed zips are deleted after processing, so this mainly guards against
// reprocessing the current incoming batch).

interface State {
  processed?: string[]
}

export function loadProcessed(stateFile: string): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8")) as State
    return new Set(data.processed ?? [])
  } catch {
    return new Set()
  }
}

export function saveProcessed(stateFile: string, processed: Set<string>): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const data: State = { processed: [...processed].sort() }
  fs.writeFileSync(stateFile, JSON.stringify(data, null, 2))
}
