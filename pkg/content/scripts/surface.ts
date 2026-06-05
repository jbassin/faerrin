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
  judge <date|all> [--mode hybrid|full] [--write]
                              LLM-judge candidates; --write appends confirms to defs.yaml

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

async function runJudge(rest: string[], json: boolean): Promise<void> {
  const { findKnown } = await import("./surface/known")
  const { judgeSession } = await import("./surface/judge")
  const { readSession, listSessionDates } = await import("./surface/tokens")
  const { buildLexicon } = await import("./lib/lexicon")
  const { addCorrection } = await import("./lib/defs")
  const { surface } = await import("./config")

  const mode = rest.includes("--mode")
    ? (rest[rest.indexOf("--mode") + 1] as "hybrid" | "full")
    : "hybrid"
  const write = rest.includes("--write")
  const lex = await buildLexicon()
  const target = rest.find((a) => !a.startsWith("--") && a !== mode) ?? "all"
  const dates = target === "all" ? await listSessionDates() : [target]

  const report: Record<string, unknown> = {}
  for (const date of dates) {
    const t = await readSession(date)
    if (!t) {
      log.warn(`no session "${date}"`)
      continue
    }
    const flagged = mode === "full" ? [] : findKnown(t, lex).map((c) => ({ lineRef: c.lineRef, span: c.span }))
    const verdicts = await judgeSession(t, flagged, lex, { mode })
    const confirms = verdicts.filter((v) => v.verdict === "confirm" && v.confidence >= surface.confidenceFloor)

    let written = 0
    if (write) {
      for (const c of confirms) {
        if (!c.suggestedCanonical) continue
        const res = await addCorrection(c.suggestedCanonical, c.span)
        if (res.added) written++
      }
    }

    if (json) {
      report[date] = { verdicts, written }
    } else {
      console.log(`${date}: ${confirms.length} confirm(s), ${verdicts.length} judged${write ? `, ${written} written` : ""}`)
      for (const c of confirms) {
        console.log(`  [${c.lineRef}] "${c.span}" → ${c.suggestedCanonical} (${c.confidence.toFixed(2)}) ${c.reason}`)
      }
    }
  }
  if (json) console.log(JSON.stringify(report, null, 2))
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
      await runJudge(rest, json)
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
