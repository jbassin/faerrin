import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Derived from this file's location so the pipeline is portable across checkouts
// (mirrors shared-content/scripts/lib/paths.ts and python/consts.py). Every path
// is overridable via a LISTENER_* env var for host cutover — see ../.env.example.
const here = path.dirname(fileURLToPath(import.meta.url)) // pkg/listener/src
export const pkgRoot = path.resolve(here, "..") // pkg/listener
export const pythonDir = path.join(pkgRoot, "python")

export const dataPath = process.env.LISTENER_DATA_PATH ?? path.join(pkgRoot, "data")
export const tmpPath = process.env.LISTENER_TMP_PATH ?? path.join(pkgRoot, "tmp")
export const incomingPath =
  process.env.LISTENER_INCOMING_PATH ?? path.join(os.homedir(), "drive", "Craig")
export const stateFile = process.env.LISTENER_STATE_FILE ?? path.join(dataPath, "state.json")
