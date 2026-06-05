// Ledger of sessions already reviewed in the surfacer, so `surface review` can
// skip them instead of re-prompting the same candidates. Stored as a committed
// JSON map (date → when it was reviewed) in scripts/reviewed.json. Keys are kept
// in chronological order so diffs stay readable.

import fs from "node:fs/promises"
import { reviewedPath } from "../lib/paths"

export interface ReviewedEntry {
  /** ISO timestamp of when the session was last fully reviewed. */
  reviewedAt: string
}

export type ReviewedLedger = Record<string, ReviewedEntry>

function byDate(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime()
}

/** Load the ledger, or an empty one if the file is missing/unreadable. */
export async function loadReviewed(file = reviewedPath): Promise<ReviewedLedger> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as ReviewedLedger
  } catch {
    return {}
  }
}

/** Record that `date` was fully reviewed (idempotent; refreshes the timestamp). */
export async function markReviewed(date: string, now = new Date(), file = reviewedPath): Promise<void> {
  const ledger = await loadReviewed(file)
  ledger[date] = { reviewedAt: now.toISOString() }
  const sorted: ReviewedLedger = {}
  for (const k of Object.keys(ledger).sort(byDate)) sorted[k] = ledger[k]
  await fs.writeFile(file, JSON.stringify(sorted, null, 2) + "\n", "utf8")
}
