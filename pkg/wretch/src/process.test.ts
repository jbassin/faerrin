import { test, expect, describe } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pendingSessions } from "./process.ts"

// Zip names follow Craig's 4-field underscore form; parseDate takes the 3rd field.
const zip = (date: string) => `/incoming/rec_session_${date}_final.zip`

describe("pendingSessions (disk is the ledger)", () => {
  test("a session with an existing script.json is not pending", () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "wretch-data-"))
    try {
      fs.mkdirSync(path.join(data, "saved", "2026-6-1"), { recursive: true })
      fs.writeFileSync(path.join(data, "saved", "2026-6-1", "script.json"), "[]")

      const result = pendingSessions([zip("2026-6-1"), zip("2026-6-8")], data)
      expect(result.map((p) => p.date)).toEqual(["2026-6-8"])
    } finally {
      fs.rmSync(data, { recursive: true, force: true })
    }
  })

  test("zips whose name has no parseable date are ignored", () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "wretch-data-"))
    try {
      expect(pendingSessions(["/incoming/garbage.zip"], data)).toEqual([])
    } finally {
      fs.rmSync(data, { recursive: true, force: true })
    }
  })

  test("all-new incoming yields one pending entry per session", () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "wretch-data-"))
    try {
      const result = pendingSessions([zip("2026-1-1"), zip("2026-1-8")], data)
      expect(result.map((p) => p.date)).toEqual(["2026-1-1", "2026-1-8"])
    } finally {
      fs.rmSync(data, { recursive: true, force: true })
    }
  })
})
