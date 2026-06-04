import type { Segment } from "./types.ts"

// Time-orders per-user transcript segments into a single stream. Each `add`
// pushes one user's segment array as a "stack"; `drain` repeatedly emits the
// globally-earliest remaining segment (by `start`), tagging it with its user.
//
// Faithful TS port of the original sound_stack.py (pop-from-front merge), so the
// resulting script.json ordering matches the Python pipeline.
export class SoundStack {
  private readonly sounds: Record<string, Segment[][]> = {}

  add(user: string, segments: Segment[]): void {
    const stack = this.sounds[user] ?? []
    stack.push(segments)
    this.sounds[user] = stack
  }

  next(): Segment | null {
    let lowestUser = ""
    let lowestIdx = -1
    let lowestStart = Number.POSITIVE_INFINITY

    for (const user of Object.keys(this.sounds)) {
      const stacks = this.sounds[user]!
      for (let idx = 0; idx < stacks.length; idx++) {
        const val = stacks[idx]!
        if (val.length === 0) continue
        const start = val[0]!.start ?? Number.POSITIVE_INFINITY
        if (start < lowestStart) {
          lowestUser = user
          lowestIdx = idx
          lowestStart = start
        }
      }
    }

    if (lowestUser === "") return null

    const stk = this.sounds[lowestUser]![lowestIdx]!
    const res = stk.shift()! // pop(0)
    res.user = lowestUser
    return res
  }

  drain(): Segment[] {
    const res: Segment[] = []
    for (;;) {
      const n = this.next()
      if (n === null) break
      res.push(n)
    }
    return res
  }
}
