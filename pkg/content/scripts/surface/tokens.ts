// Session I/O for the surfacer. Reads the (already correction-applied) per-session
// JSON in scripts/data/ — so the surfacer only sees errors NOT yet captured by
// defs.yaml, which is exactly what we want to flag.

import fs from "node:fs/promises"
import path from "node:path"
import { dataDir } from "../lib/paths"
import type { Transcript } from "../lib/types"

/** Read one session transcript by date (e.g. "2026-5-21"), or null if absent. */
export async function readSession(date: string): Promise<Transcript | null> {
  try {
    const raw = await fs.readFile(path.join(dataDir, `${date}.json`), "utf8")
    return JSON.parse(raw) as Transcript
  } catch {
    return null
  }
}

/** All session dates in scripts/data/, newest first. */
export async function listSessionDates(): Promise<string[]> {
  const files = await fs.readdir(dataDir)
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
}
