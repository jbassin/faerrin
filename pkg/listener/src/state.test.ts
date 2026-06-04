import { test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadProcessed, saveProcessed } from "./state.ts"

test("missing state file reads as empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-state-"))
  try {
    expect(loadProcessed(path.join(dir, "nope.json"))).toEqual(new Set())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("processed set round-trips through a nested path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-state-"))
  try {
    const file = path.join(dir, "nested", "state.json")
    const expected = new Set(["a.zip", "b.zip"])
    saveProcessed(file, expected)
    expect(loadProcessed(file)).toEqual(expected)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
