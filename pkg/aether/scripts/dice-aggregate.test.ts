/**
 * Unit tests for the pure /dice aggregation core. Run: `bun test` (from pkg/aether).
 * No database — synthetic rows exercise the stats, timeline, and leaderboards.
 */
import { describe, expect, test } from "bun:test"
import { aggregateDice, toBaseStats, type PlayerInfo, type RawRoll } from "./dice-aggregate.ts"

const players = new Map<number, PlayerInfo>([
  [1, { name: "Josh", character: "Gamemaster", class: "gm" }],
  [2, { name: "Jorge", character: "Kajymo", class: "rogue" }],
])

function d20Rolls(pid: number, values: number[], startDay = 1): RawRoll[] {
  return values.map((v, i) => ({
    t: `2024-01-${String(startDay + (i % 27)).padStart(2, "0")} 12:00:00`,
    b: 20,
    v,
    pid,
    src: "discord",
  }))
}

describe("toBaseStats", () => {
  test("d20 crits/fumbles/mean/luck", () => {
    // values: one nat 1, one nat 20, rest 10s → mean pulled by the extremes
    const hist = new Array(20).fill(0)
    hist[0] = 1 // value 1
    hist[19] = 1 // value 20
    hist[9] = 8 // value 10 ×8
    const s = toBaseStats(20, { count: 10, sum: 1 + 20 + 10 * 8, hist })
    expect(s.crits).toBe(1)
    expect(s.fumbles).toBe(1)
    expect(s.expectedMean).toBe(10.5)
    expect(s.mean).toBeCloseTo(10.1, 5)
    expect(s.luckDeviation).toBeCloseTo(-0.4, 5)
    expect(s.critRate).toBeCloseTo(0.1, 5)
    expect(s.luckZ).not.toBeNull()
  })

  test("d1 is degenerate: counts but no variance stats", () => {
    const s = toBaseStats(1, { count: 5, sum: 5, hist: [5] })
    expect(s.count).toBe(5)
    expect(s.crits).toBeNull()
    expect(s.fumbles).toBeNull()
    expect(s.critRate).toBeNull()
    expect(s.luckZ).toBeNull()
    expect(s.expectedMean).toBe(1)
  })

  test("a perfectly fair-mean die has ~zero luck deviation", () => {
    // d6 with mean exactly 3.5
    const hist = [10, 10, 10, 10, 10, 10]
    const s = toBaseStats(6, { count: 60, sum: 60 * 3.5, hist })
    expect(s.luckDeviation).toBeCloseTo(0, 9)
    expect(s.luckZ).toBeCloseTo(0, 9)
  })
})

describe("aggregateDice", () => {
  test("empty input is safe", () => {
    const { summary, rolls } = aggregateDice([], players)
    expect(summary.meta.totalRolls).toBe(0)
    expect(summary.meta.dateRange.from).toBe("")
    expect(summary.perPlayer).toEqual([])
    expect(rolls).toEqual([])
    expect(summary.leaderboards.luckiest).toEqual([])
  })

  test("per-player totals, names, sorting, and raw rolls", () => {
    const rows: RawRoll[] = [
      ...d20Rolls(1, new Array(30).fill(11)), // Josh 30 d20s
      ...d20Rolls(2, new Array(25).fill(9)), // Jorge 25 d20s
      { t: "2024-02-01 00:00:00", b: 6, v: 4, pid: 1, src: "discord" }, // Josh +1 d6
    ]
    const { summary, rolls } = aggregateDice(rows, players)
    expect(summary.meta.totalRolls).toBe(56)
    expect(summary.meta.players[0]).toBe("Josh") // most rolls first
    const josh = summary.perPlayer.find((p) => p.name === "Josh")!
    expect(josh.totalRolls).toBe(31)
    expect(josh.character).toBe("Gamemaster")
    expect(Object.keys(josh.byBase).sort()).toEqual(["20", "6"])
    expect(summary.meta.bases).toEqual([6, 20])
    expect(rolls.length).toBe(56)
    expect(rolls[0]).toMatchObject({ p: "Josh", b: 20, v: 11 })
  })

  test("unknown player_id falls back to a label", () => {
    const { summary } = aggregateDice(d20Rolls(99, new Array(20).fill(10)), players)
    expect(summary.perPlayer[0]!.name).toBe("Player 99")
  })

  test("leaderboards rank by d20 luck and ignore tiny samples", () => {
    const rows: RawRoll[] = [
      ...d20Rolls(1, new Array(40).fill(15)), // Josh: high mean (lucky)
      ...d20Rolls(2, new Array(40).fill(6)), // Jorge: low mean (unlucky)
      ...d20Rolls(3, [20, 20, 20]), // 3 rolls — below MIN sample, excluded
    ]
    const lb = aggregateDice(rows, players).summary.leaderboards
    expect(lb.luckiest[0]!.name).toBe("Josh")
    expect(lb.unluckiest[0]!.name).toBe("Jorge")
    // the 3-roll player must not appear in luck boards
    expect(lb.luckiest.find((e) => e.name === "Player 3")).toBeUndefined()
  })

  test("timeline buckets monthly", () => {
    const rows: RawRoll[] = [
      { t: "2024-01-05 10:00:00", b: 20, v: 10, pid: 1, src: "discord" },
      { t: "2024-01-20 10:00:00", b: 20, v: 10, pid: 1, src: "discord" },
      { t: "2024-02-02 10:00:00", b: 20, v: 10, pid: 2, src: "discord" },
    ]
    const tl = aggregateDice(rows, players).summary.timeline
    expect(tl.map((b) => b.period)).toEqual(["2024-01", "2024-02"])
    expect(tl[0]!.total).toBe(2)
    expect(tl[0]!.perPlayer["Josh"]).toBe(2)
    expect(tl[1]!.perPlayer["Jorge"]).toBe(1)
  })
})
