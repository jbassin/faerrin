import { test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeAtomic } from "./fsx.ts"

test("writeAtomic writes the file and leaves no .tmp behind", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-fsx-"))
  try {
    const target = path.join(dir, "script.json")
    writeAtomic(target, '{"ok":true}')
    expect(fs.readFileSync(target, "utf8")).toBe('{"ok":true}')
    expect(fs.existsSync(`${target}.tmp`)).toBe(false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("writeAtomic overwrites an existing file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "listener-fsx-"))
  try {
    const target = path.join(dir, "out.json")
    writeAtomic(target, "old")
    writeAtomic(target, "new")
    expect(fs.readFileSync(target, "utf8")).toBe("new")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
