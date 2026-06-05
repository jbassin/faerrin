import { test, expect } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadReviewed, markReviewed } from "./reviewed"

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reviewed-"))
  return path.join(dir, "reviewed.json")
}

test("missing file loads as an empty ledger", async () => {
  expect(await loadReviewed(path.join(os.tmpdir(), "does-not-exist-xyz.json"))).toEqual({})
})

test("markReviewed persists and round-trips", async () => {
  const file = await tmpFile()
  await markReviewed("2026-5-21", new Date("2026-06-05T12:00:00Z"), file)
  const ledger = await loadReviewed(file)
  expect(ledger["2026-5-21"].reviewedAt).toBe("2026-06-05T12:00:00.000Z")
})

test("keys are written in chronological order regardless of insert order", async () => {
  const file = await tmpFile()
  await markReviewed("2026-5-21", new Date(), file)
  await markReviewed("2024-10-15", new Date(), file)
  await markReviewed("2025-1-3", new Date(), file)
  const keys = Object.keys(JSON.parse(await fs.readFile(file, "utf8")))
  expect(keys).toEqual(["2024-10-15", "2025-1-3", "2026-5-21"])
})

test("re-marking refreshes the timestamp without duplicating the key", async () => {
  const file = await tmpFile()
  await markReviewed("2026-5-21", new Date("2026-01-01T00:00:00Z"), file)
  await markReviewed("2026-5-21", new Date("2026-02-02T00:00:00Z"), file)
  const ledger = await loadReviewed(file)
  expect(Object.keys(ledger)).toEqual(["2026-5-21"])
  expect(ledger["2026-5-21"].reviewedAt).toBe("2026-02-02T00:00:00.000Z")
})
