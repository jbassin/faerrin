import { test, expect, describe } from "bun:test"
import { SoundStack } from "./soundStack.ts"
import type { Segment } from "./types.ts"

const seg = (start: number, text: string): Segment => ({ start, end: start + 1, text })

describe("SoundStack", () => {
  test("empty stack drains to nothing", () => {
    expect(new SoundStack().drain()).toEqual([])
  })

  test("interleaves two users by start time and tags each with its user", () => {
    const s = new SoundStack()
    s.add("alice", [seg(0, "a0"), seg(10, "a10")])
    s.add("bob", [seg(5, "b5"), seg(7, "b7")])

    const drained = s.drain()
    expect(drained.map((d) => d.text)).toEqual(["a0", "b5", "b7", "a10"])
    expect(drained.map((d) => d.user)).toEqual(["alice", "bob", "bob", "alice"])
  })

  test("preserves within-track order (segments pop from the front)", () => {
    const s = new SoundStack()
    s.add("x", [seg(0, "first"), seg(1, "second"), seg(2, "third")])
    expect(s.drain().map((d) => d.text)).toEqual(["first", "second", "third"])
  })

  test("multiple add() calls for the same user are independent stacks", () => {
    const s = new SoundStack()
    s.add("x", [seg(0, "p"), seg(9, "q")])
    s.add("x", [seg(3, "r")])
    expect(s.drain().map((d) => d.text)).toEqual(["p", "r", "q"])
  })

  test("next() returns null once exhausted", () => {
    const s = new SoundStack()
    s.add("x", [seg(0, "only")])
    expect(s.next()?.text).toBe("only")
    expect(s.next()).toBeNull()
  })
})
