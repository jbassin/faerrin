/**
 * Pure aggregation core for the /dice export (no I/O — unit-tested in
 * dice-aggregate.test.ts). export-dice.ts handles reading the DB / writing files
 * and delegates the math here so it can be tested without a database.
 *
 * Contract: thoughts/aether/plans/0001 §4 + src/lib/dice-schema.ts.
 */
import {
  type BaseStats,
  type DiceRoll,
  type DiceSummary,
  type LeaderEntry,
  type Leaderboards,
  type PlayerSummary,
  type TimelineBucket,
} from "../src/lib/dice-schema.ts"

/** One raw row from the `dice` table, already filtered (base<=cap, player allowed). */
export interface RawRoll {
  t: string
  b: number
  v: number
  pid: number
  src: string
}
export interface PlayerInfo {
  name: string
  character: string
  class: string
}

const TOP_N = 10
const MIN_D20_SAMPLE = 20 // ignore players with too few d20 rolls in leaderboards

export const nameOf = (players: Map<number, PlayerInfo>, pid: number) =>
  players.get(pid)?.name ?? `Player ${pid}`

interface Accum {
  count: number
  sum: number
  hist: number[]
}

export function toBaseStats(base: number, a: Accum): BaseStats {
  const mean = a.sum / a.count
  const expectedMean = (base + 1) / 2
  const hasVariance = base > 1
  const crits = hasVariance ? a.hist[base - 1]! : null
  const fumbles = hasVariance ? a.hist[0]! : null
  const se = hasVariance ? Math.sqrt((base * base - 1) / 12 / a.count) : 0
  const luckZ = hasVariance && se > 0 ? (mean - expectedMean) / se : null
  return {
    base,
    count: a.count,
    mean,
    expectedMean,
    histogram: a.hist,
    crits,
    fumbles,
    critRate: crits === null ? null : crits / a.count,
    fumbleRate: fumbles === null ? null : fumbles / a.count,
    luckDeviation: mean - expectedMean,
    luckZ,
  }
}

function pct(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(1)}%`
}

/** Build the full summary + raw-roll feed from already-filtered, time-sorted rows. */
export function aggregateDice(
  rows: RawRoll[],
  players: Map<number, PlayerInfo>,
): { summary: DiceSummary; rolls: DiceRoll[] } {
  const nameFor = (pid: number) => nameOf(players, pid)

  // per player → base → accumulator
  const perPlayerAcc = new Map<number, Map<number, Accum>>()
  for (const r of rows) {
    let byBase = perPlayerAcc.get(r.pid)
    if (!byBase) perPlayerAcc.set(r.pid, (byBase = new Map()))
    let acc = byBase.get(r.b)
    if (!acc) byBase.set(r.b, (acc = { count: 0, sum: 0, hist: new Array(r.b).fill(0) }))
    acc.count++
    acc.sum += r.v
    if (r.v >= 1 && r.v <= r.b) acc.hist[r.v - 1]!++
  }

  const perPlayer: PlayerSummary[] = []
  for (const [pid, byBase] of perPlayerAcc) {
    const stats: Record<string, BaseStats> = {}
    let total = 0
    for (const [base, acc] of [...byBase].sort((x, y) => x[0] - y[0])) {
      stats[String(base)] = toBaseStats(base, acc)
      total += acc.count
    }
    const info = players.get(pid)
    perPlayer.push({
      playerId: pid,
      name: nameFor(pid),
      character: info?.character ?? "",
      class: info?.class ?? "",
      totalRolls: total,
      byBase: stats,
    })
  }
  perPlayer.sort((a, b) => b.totalRolls - a.totalRolls)

  // timeline (monthly)
  const tlMap = new Map<string, TimelineBucket>()
  for (const r of rows) {
    const period = r.t.slice(0, 7)
    let b = tlMap.get(period)
    if (!b) tlMap.set(period, (b = { period, total: 0, perPlayer: {} }))
    b.total++
    const n = nameFor(r.pid)
    b.perPlayer[n] = (b.perPlayer[n] ?? 0) + 1
  }
  const timeline = [...tlMap.values()].sort((a, b) => a.period.localeCompare(b.period))

  // leaderboards (keyed on d20)
  const d20 = (p: PlayerSummary) => p.byBase["20"]
  const withD20 = perPlayer.filter((p) => (d20(p)?.count ?? 0) >= MIN_D20_SAMPLE)
  const board = (
    pick: (p: PlayerSummary) => number | null | undefined,
    dir: "desc" | "asc",
    detail?: (p: PlayerSummary) => string,
  ): LeaderEntry[] =>
    withD20
      .map((p) => ({ name: p.name, value: pick(p) ?? 0, detail: detail?.(p) }))
      .sort((a, b) => (dir === "desc" ? b.value - a.value : a.value - b.value))
      .slice(0, TOP_N)

  const leaderboards: Leaderboards = {
    luckiest: board((p) => d20(p)!.luckDeviation, "desc", (p) => `n=${d20(p)!.count}`),
    unluckiest: board((p) => d20(p)!.luckDeviation, "asc", (p) => `n=${d20(p)!.count}`),
    mostCrits: board((p) => d20(p)!.crits, "desc", (p) => `${pct(d20(p)!.critRate)} rate`),
    mostFumbles: board((p) => d20(p)!.fumbles, "desc", (p) => `${pct(d20(p)!.fumbleRate)} rate`),
    mostRolls: perPlayer.slice(0, TOP_N).map((p) => ({ name: p.name, value: p.totalRolls })),
  }

  const bases = [...new Set(rows.map((r) => r.b))].sort((a, b) => a - b)
  const summary: DiceSummary = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalRolls: rows.length,
      dateRange: {
        from: rows.length ? rows[0]!.t : "",
        to: rows.length ? rows[rows.length - 1]!.t : "",
      },
      players: perPlayer.map((p) => p.name),
      bases,
      filter: { baseCap: 100, excludedPlayerIds: [6] },
    },
    perPlayer,
    timeline,
    leaderboards,
  }

  const rolls: DiceRoll[] = rows.map((r) => ({ t: r.t, p: nameFor(r.pid), b: r.b, v: r.v }))
  return { summary, rolls }
}
