/**
 * One-shot Postgres → SQLite migration for the speaks cutover (Phase 4).
 *
 * Copies the bot's RUNTIME state — `dice` history + `funcs` macros — into a fresh
 * SQLite file. Identity tables are NOT copied (identity lives in players.toml).
 *
 * By default it EXCLUDES the junk `d123456789` mega-roll (47.16M rows of one
 * pathological dice pool), keeping ~19k rows of genuine history. Adjust with
 * --exclude-base / --keep-all.
 *
 * Usage (run during the freeze window — bot stopped):
 *   PG_URL="postgres://…"  bun scripts/migrate-to-sqlite.ts --out /path/speaks.db
 *   bun scripts/migrate-to-sqlite.ts --out speaks.db --keep-all
 *   bun scripts/migrate-to-sqlite.ts --out speaks.db --exclude-base 123456789
 *
 * Reads PG_URL (or DATABASE_URL if it's a postgres:// url) for the source.
 */
import { SQL } from "bun"
import { Database } from "bun:sqlite"

const args = process.argv.slice(2)
const opt = (k: string, d?: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? (args[i + 1] ?? "") : d
}
const out = opt("--out", "speaks.db")!
const keepAll = args.includes("--keep-all")
const excludeBase = Number(opt("--exclude-base", "123456789"))

const pgUrl = process.env.PG_URL ?? process.env.DATABASE_URL ?? ""
if (!pgUrl.startsWith("postgres")) {
  console.error("set PG_URL (or DATABASE_URL) to the source postgres:// connection")
  process.exit(1)
}

const pg = new SQL(pgUrl)
const sqlite = new Database(out)
sqlite.exec(await Bun.file(`${import.meta.dir}/../crates/discord/migrations/0001_init.sql`).text())

// --- funcs (tiny) ---
const funcs = await pg`select name, payload from funcs`
const insFunc = sqlite.prepare("insert into funcs (name, payload) values (?, ?)")
sqlite.transaction(() => {
  for (const f of funcs as any[]) insFunc.run(f.name, f.payload)
})()
console.log(`funcs: ${funcs.length} rows`)

// --- dice (filtered, batched) ---
const where = keepAll ? pg`` : pg`where base <> ${excludeBase}`
const [{ n }] = await pg`select count(*)::bigint as n from dice ${where}`
const total = Number(n)
console.log(`dice to migrate: ${total.toLocaleString()}${keepAll ? " (ALL)" : ` (excluding base ${excludeBase})`}`)

const insDie = sqlite.prepare(
  "insert into dice (base, value, source, player_id, blame_id, timestamp) values (?, ?, ?, ?, ?, ?)",
)
const fmt = (t: Date) => t.toISOString().replace("T", " ").slice(0, 19)
const BATCH = 50_000
let done = 0
for (let off = 0; off < total; off += BATCH) {
  const rows = keepAll
    ? await pg`select base, value, source::text as source, player_id, blame_id, timestamp
               from dice order by id limit ${BATCH} offset ${off}`
    : await pg`select base, value, source::text as source, player_id, blame_id, timestamp
               from dice where base <> ${excludeBase} order by id limit ${BATCH} offset ${off}`
  sqlite.transaction(() => {
    for (const r of rows as any[]) insDie.run(r.base, r.value, r.source, r.player_id, r.blame_id, fmt(r.timestamp))
  })()
  done += rows.length
  process.stdout.write(`\r  ${done.toLocaleString()} / ${total.toLocaleString()}`)
}
console.log(`\ndice: ${done.toLocaleString()} rows migrated`)

sqlite.close()
await pg.end()
console.log(`\n✓ wrote ${out} — point DATABASE_URL at sqlite://${out} and start the bot.`)
