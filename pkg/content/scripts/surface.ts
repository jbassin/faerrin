// Typo-surfacer CLI. Flags likely transcription errors so the user can update
// defs.yaml without reading every line in `bun run review`.
//
//   surface known <date|all>          Mode 1: known-entity correction candidates
//   surface discover [--min-count N]  Mode 2: recurring unknown entities (cross-session)
//   surface judge ...                 Phase 2 (LLM) — not yet implemented
//
// Flags: --json (machine-readable output)

import { log } from "./lib/log"
import { buildLexicon } from "./lib/lexicon"

function usage(): void {
  console.log(`Usage: tsx scripts/surface.ts <command> [args]

  known <date|all>            surface known-entity correction candidates
  discover [--min-count N]    surface recurring unknown entities across all sessions
  judge <date|all>            (Phase 2) LLM judge over candidates

Flags:
  --json                      emit machine-readable JSON`)
}

async function runKnown(rest: string[], json: boolean): Promise<void> {
  const { findKnown } = await import("./surface/known")
  const { readSession, listSessionDates } = await import("./surface/tokens")
  const { renderKnown } = await import("./surface/report")

  const lex = await buildLexicon()
  const target = rest.find((a) => !a.startsWith("--")) ?? "all"
  const dates = target === "all" ? await listSessionDates() : [target]

  const results: Record<string, unknown> = {}
  for (const date of dates) {
    const t = await readSession(date)
    if (!t) {
      log.warn(`no session "${date}"`)
      continue
    }
    const cands = findKnown(t, lex)
    if (json) results[date] = cands
    else console.log(renderKnown(date, cands))
  }
  if (json) console.log(JSON.stringify(results, null, 2))
}

async function runDiscover(rest: string[], json: boolean): Promise<void> {
  const { discover } = await import("./surface/discover")
  const { renderClusters } = await import("./surface/report")

  const lex = await buildLexicon()
  const mi = rest.indexOf("--min-count")
  const minCount = mi >= 0 ? Number(rest[mi + 1]) : undefined

  const clusters = await discover(lex, { minCount })
  if (json) console.log(JSON.stringify(clusters, null, 2))
  else console.log(renderClusters(clusters))
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const rest = argv.slice(1)
  const json = rest.includes("--json")

  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage()
    return
  }

  switch (cmd) {
    case "known":
      await runKnown(rest, json)
      return
    case "discover":
      await runDiscover(rest, json)
      return
    case "judge":
      log.info("`judge` arrives in Phase 2 (LLM).")
      return
    default:
      log.error(`unknown command "${cmd}"`)
      usage()
      process.exit(1)
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
