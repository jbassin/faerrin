/**
 * Export mouth's historical dice rolls into static artifacts for the /dice
 * dashboard (plan: thoughts/aether/plans/0001-dice-data-webui.md).
 *
 * READ-ONLY against the source SQLite DB. Run on the deploy host BEFORE
 * `astro build` (the nightly systemd timer does exactly this — deploy/DICE.md).
 * The aggregation math lives in dice-aggregate.ts (unit-tested); this file only
 * reads the DB / players.toml and writes the four artifacts.
 *
 * Emits into --out (default assets/dice/, copied to public/dice/ by the build):
 *   summary.json  — aggregated viz feed (DiceSummary)
 *   rolls.json    — compact raw rows for the table (DiceRoll[])
 *   rolls.csv     — download (timestamp,player,character,base,value,source)
 *   rolls.parquet — download (same rows, columnar)
 *
 * Filter: base <= BASE_CAP AND player_id NOT IN EXCLUDED_PLAYER_IDS.
 *
 * Usage:
 *   bun scripts/export-dice.ts
 *   bun scripts/export-dice.ts --db ../mouth/mouth.db --players ../mouth/players.toml --out assets/dice
 */
import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { parse as parseToml } from "smol-toml"
import { parquetWriteBuffer } from "hyparquet-writer"
import { BASE_CAP, EXCLUDED_PLAYER_IDS } from "../src/lib/dice-schema.ts"
import { aggregateDice, nameOf, type PlayerInfo, type RawRoll } from "./dice-aggregate.ts"

const args = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? (args[i + 1] ?? d) : d
}
const dbPath = opt("--db", "../mouth/mouth.db")
const playersPath = opt("--players", "../mouth/players.toml")
const outDir = opt("--out", "assets/dice")

// --- identity: player_id → name/character/class (players.toml) ---
interface PlayerToml {
  name: string
  player_id: number
  character?: string
  class?: string
}
const playersDoc = parseToml(await Bun.file(playersPath).text()) as { players?: PlayerToml[] }
const players = new Map<number, PlayerInfo>()
for (const p of playersDoc.players ?? [])
  players.set(p.player_id, { name: p.name, character: p.character ?? "", class: p.class ?? "" })

// --- read (read-only) ---
const db = new Database(dbPath, { readonly: true })
const rows = db
  .query(
    `select timestamp as t, base as b, value as v, player_id as pid, source as src
       from dice
      where base <= ${BASE_CAP} and player_id not in (${EXCLUDED_PLAYER_IDS.join(",")})
      order by timestamp asc`,
  )
  .all() as RawRoll[]
db.close()

// --- aggregate (pure) ---
const { summary, rolls } = aggregateDice(rows, players)

// --- write artifacts ---
mkdirSync(outDir, { recursive: true })
await Bun.write(`${outDir}/summary.json`, JSON.stringify(summary))
await Bun.write(`${outDir}/rolls.json`, JSON.stringify(rolls))

const charFor = (pid: number) => players.get(pid)?.character ?? ""
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`
const csvLines = ["timestamp,player,character,base,value,source"]
for (const r of rows) {
  csvLines.push(
    [csvCell(r.t), csvCell(nameOf(players, r.pid)), csvCell(charFor(r.pid)), r.b, r.v, csvCell(r.src)].join(
      ",",
    ),
  )
}
await Bun.write(`${outDir}/rolls.csv`, csvLines.join("\n") + "\n")

const parquet = parquetWriteBuffer({
  columnData: [
    { name: "timestamp", data: rows.map((r) => r.t), type: "STRING" },
    { name: "player", data: rows.map((r) => nameOf(players, r.pid)), type: "STRING" },
    { name: "character", data: rows.map((r) => charFor(r.pid)), type: "STRING" },
    { name: "base", data: rows.map((r) => r.b), type: "INT32" },
    { name: "value", data: rows.map((r) => r.v), type: "INT32" },
    { name: "source", data: rows.map((r) => r.src), type: "STRING" },
  ],
})
await Bun.write(`${outDir}/rolls.parquet`, parquet)

console.log(
  `exported ${rows.length} rolls · ${summary.perPlayer.length} players · ${summary.meta.bases.length} bases → ${outDir}/`,
)
