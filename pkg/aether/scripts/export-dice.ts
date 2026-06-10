/**
 * Export mouth's historical dice rolls into static artifacts for the /dice
 * dashboard (plan: thoughts/aether/plans/0001-dice-data-webui.md).
 *
 * READ-ONLY against the source SQLite DB. Run on the deploy host BEFORE
 * `astro build` (the nightly systemd timer does exactly this — deploy/DICE.md).
 *
 * Emits into --out (default assets/dice/, which the Astro build copies to
 * public/dice/ and Caddy serves):
 *   summary.json  — aggregated viz feed (DiceSummary)
 *   rolls.json    — compact raw rows for the table (DiceRoll[])
 *   rolls.csv     — download (timestamp,player,character,base,value,source)
 *   rolls.parquet — download (same rows, columnar)
 *
 * Filter (DiceSchema): base <= BASE_CAP AND player_id NOT IN EXCLUDED_PLAYER_IDS.
 * d1 counts toward totals but is excluded from luck/crit stats (no variance).
 *
 * Usage:
 *   bun scripts/export-dice.ts
 *   bun scripts/export-dice.ts --db ../mouth/mouth.db --players ../mouth/players.toml --out assets/dice
 */
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { parse as parseToml } from "smol-toml"
import { parquetWriteBuffer } from "hyparquet-writer"
import {
  BASE_CAP,
  EXCLUDED_PLAYER_IDS,
  type BaseStats,
  type DiceRoll,
  type DiceSummary,
  type LeaderEntry,
  type Leaderboards,
  type PlayerSummary,
  type TimelineBucket,
} from "../src/lib/dice-schema.ts"

const args = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? (args[i + 1] ?? d) : d
}

const dbPath = opt("--db", "../mouth/mouth.db")
const playersPath = opt("--players", "../mouth/players.toml")
const outDir = opt("--out", "assets/dice")
const TOP_N = 10 // leaderboard depth

// --- identity: player_id → name/character/class (players.toml) ---
interface PlayerRow {
  name: string
  player_id: number
  character?: string
  class?: string
}
const playersDoc = parseToml(await Bun.file(playersPath).text()) as { players?: PlayerRow[] }
const idToPlayer = new Map<number, PlayerRow>()
for (const p of playersDoc.players ?? []) idToPlayer.set(p.player_id, p)
const nameFor = (pid: number) => idToPlayer.get(pid)?.name ?? `Player ${pid}`
const charFor = (pid: number) => idToPlayer.get(pid)?.character ?? ""
const classFor = (pid: number) => idToPlayer.get(pid)?.class ?? ""

// --- read (read-only) ---
interface Row {
  t: string
  b: number
  v: number
  pid: number
  src: string
}
const db = new Database(dbPath, { readonly: true })
const rows = db
  .query(
    `select timestamp as t, base as b, value as v, player_id as pid, source as src
       from dice
      where base <= ${BASE_CAP} and player_id not in (${EXCLUDED_PLAYER_IDS.join(",")})
      order by timestamp asc`,
  )
  .all() as Row[]
db.close()

// --- aggregate per player / per base ---
interface Accum {
  count: number
  sum: number
  hist: number[] // length === base
}
const perPlayerAcc = new Map<number, Map<number, Accum>>() // pid → base → accum

for (const r of rows) {
  let byBase = perPlayerAcc.get(r.pid)
  if (!byBase) perPlayerAcc.set(r.pid, (byBase = new Map()))
  let acc = byBase.get(r.b)
  if (!acc) byBase.set(r.b, (acc = { count: 0, sum: 0, hist: new Array(r.b).fill(0) }))
  acc.count++
  acc.sum += r.v
  if (r.v >= 1 && r.v <= r.b) acc.hist[r.v - 1]++
}

const toBaseStats = (base: number, a: Accum): BaseStats => {
  const mean = a.sum / a.count
  const expectedMean = (base + 1) / 2
  const hasVariance = base > 1
  const crits = hasVariance ? a.hist[base - 1] : null
  const fumbles = hasVariance ? a.hist[0] : null
  // z-score of the observed mean vs a fair die: variance of one roll = (b²−1)/12
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

const perPlayer: PlayerSummary[] = []
for (const [pid, byBase] of perPlayerAcc) {
  const stats: Record<string, BaseStats> = {}
  let total = 0
  for (const [base, acc] of [...byBase].sort((x, y) => x[0] - y[0])) {
    stats[String(base)] = toBaseStats(base, acc)
    total += acc.count
  }
  perPlayer.push({
    playerId: pid,
    name: nameFor(pid),
    character: charFor(pid),
    class: classFor(pid),
    totalRolls: total,
    byBase: stats,
  })
}
perPlayer.sort((a, b) => b.totalRolls - a.totalRolls)

// --- timeline (monthly) ---
const tlMap = new Map<string, TimelineBucket>()
for (const r of rows) {
  const period = r.t.slice(0, 7) // YYYY-MM
  let b = tlMap.get(period)
  if (!b) tlMap.set(period, (b = { period, total: 0, perPlayer: {} }))
  b.total++
  const n = nameFor(r.pid)
  b.perPlayer[n] = (b.perPlayer[n] ?? 0) + 1
}
const timeline = [...tlMap.values()].sort((a, b) => a.period.localeCompare(b.period))

// --- leaderboards (keyed on d20) ---
const d20 = (p: PlayerSummary) => p.byBase["20"]
const withD20 = perPlayer.filter((p) => d20(p) && (d20(p)!.count ?? 0) >= 20) // ignore tiny samples
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
function pct(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(1)}%`
}

// --- meta ---
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
    filter: { baseCap: BASE_CAP, excludedPlayerIds: [...EXCLUDED_PLAYER_IDS] },
  },
  perPlayer,
  timeline,
  leaderboards,
}

// --- raw rows for the table + downloads ---
const rolls: DiceRoll[] = rows.map((r) => ({ t: r.t, p: nameFor(r.pid), b: r.b, v: r.v }))

// --- write artifacts ---
mkdirSync(outDir, { recursive: true })
await Bun.write(`${outDir}/summary.json`, JSON.stringify(summary))
await Bun.write(`${outDir}/rolls.json`, JSON.stringify(rolls))

// CSV (quote string fields; numbers bare)
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`
const csvLines = ["timestamp,player,character,base,value,source"]
for (const r of rows) {
  csvLines.push(
    [csvCell(r.t), csvCell(nameFor(r.pid)), csvCell(charFor(r.pid)), r.b, r.v, csvCell(r.src)].join(
      ",",
    ),
  )
}
await Bun.write(`${outDir}/rolls.csv`, csvLines.join("\n") + "\n")

// Parquet (columnar)
const parquet = parquetWriteBuffer({
  columnData: [
    { name: "timestamp", data: rows.map((r) => r.t), type: "STRING" },
    { name: "player", data: rows.map((r) => nameFor(r.pid)), type: "STRING" },
    { name: "character", data: rows.map((r) => charFor(r.pid)), type: "STRING" },
    { name: "base", data: rows.map((r) => r.b), type: "INT32" },
    { name: "value", data: rows.map((r) => r.v), type: "INT32" },
    { name: "source", data: rows.map((r) => r.src), type: "STRING" },
  ],
})
await Bun.write(`${outDir}/rolls.parquet`, parquet)

console.log(
  `exported ${rows.length} rolls · ${perPlayer.length} players · ${bases.length} bases → ${outDir}/`,
)
console.log(`  summary.json rolls.json rolls.csv rolls.parquet`)
