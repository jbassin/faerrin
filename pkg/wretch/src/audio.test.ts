import { expect, test } from "bun:test"
import { mergeArgs } from "./audio.ts"

// Regression: the merge output path is an atomic-appearance `.tmp` sibling
// (write `.tmp` → rename). ffmpeg infers its muxer from the output extension,
// and `.tmp` is not a container — without an explicit `-f mp3` ffmpeg aborts
// with "Unable to find a suitable output format for '…audio.mp3.tmp'".
test("mergeArgs forces the mp3 muxer so a .tmp output path still encodes", () => {
  const args = mergeArgs(["a.aac", "b.aac"], "/out/audio.mp3.tmp")

  const fIdx = args.indexOf("-f")
  expect(fIdx).toBeGreaterThanOrEqual(0)
  expect(args[fIdx + 1]).toBe("mp3")

  // format flag must precede the (last) output argument, per ffmpeg argv order.
  expect(fIdx).toBeLessThan(args.length - 1)
  expect(args.at(-1)).toBe("/out/audio.mp3.tmp")
})

test("mergeArgs wires one -i per input and sizes amix to the input count", () => {
  const args = mergeArgs(["a.aac", "b.aac", "c.aac"], "/out/audio.mp3.tmp")
  expect(args.filter((a) => a === "-i")).toHaveLength(3)
  expect(args).toContain("amix=inputs=3:duration=longest:normalize=0")
})
