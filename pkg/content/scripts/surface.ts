// Typo-surfacer CLI. Flags likely transcription errors so the user can update
// defs.yaml without reading every line in `bun run review`.
//
//   surface known <date|all>          Mode 1: known-entity correction candidates
//   surface discover [--min-count N]  Mode 2: recurring unknown entities (cross-session)
//   surface judge ...                 Phase 2 (LLM) — not yet implemented
//
// Flags: --json (machine-readable output)

import { log } from "./lib/log"
import { color } from "./lib/color"
import { buildLexicon } from "./lib/lexicon"
import type { Annotations, ReviewDeps } from "./surface/interactive"

function usage(): void {
  console.log(`Usage: tsx scripts/surface.ts <command> [args]

  known <date|all>            surface known-entity correction candidates
  discover [--min-count N]    surface recurring unknown entities across all sessions
  judge <date|all> [--mode hybrid|full] [--write]
                              LLM-judge candidates; --write appends confirms to defs.yaml
  review <date|all> [--judge] interactively approve/change/deny candidates → defs.yaml
                              (--judge annotates each with an LLM verdict; needs ANTHROPIC_API_KEY)
  review --discover [--min-count N]
                              interactively canonicalize discovery clusters → defs.yaml

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

interface Terminal {
  /** Read a single keystroke (no Enter) — for actions. */
  key(prompt: string): Promise<string>
  /** Read a full Enter-terminated line — for typed text. */
  line(prompt: string): Promise<string>
  close(): void
}

/**
 * Line-buffered reader for piped stdin / tests: buffers lines that arrive ahead of
 * a prompt and treats EOF / Ctrl-D as a quit ("q"). `key` and `line` are the same
 * here — single keystrokes aren't possible without a TTY.
 */
async function makeLineTerminal(): Promise<Terminal> {
  const readline = await import("node:readline")
  // @types/bun's readline Interface doesn't surface EventEmitter methods; cast.
  const rl = readline.createInterface({ input: process.stdin }) as unknown as {
    on(event: "line", cb: (line: string) => void): void
    on(event: "close", cb: () => void): void
    close(): void
  }
  const buffer: string[] = []
  const waiters: Array<(line: string) => void> = []
  let closed = false
  rl.on("line", (line) => {
    const w = waiters.shift()
    if (w) w(line)
    else buffer.push(line)
  })
  rl.on("close", () => {
    closed = true
    while (waiters.length) (waiters.shift() as (l: string) => void)("q")
  })
  const ask = (prompt: string): Promise<string> => {
    process.stdout.write(prompt)
    const next = buffer.shift()
    if (next !== undefined) return Promise.resolve(next)
    if (closed) return Promise.resolve("q")
    return new Promise<string>((res) => waiters.push(res))
  }
  return { key: ask, line: ask, close: () => rl.close() }
}

/**
 * Raw-mode terminal: single keystrokes for actions (no Enter) and line editing for
 * typed text. Falls back to line-buffered reads when stdin is not a TTY.
 */
async function makeTerminal(): Promise<Terminal> {
  const stdin = process.stdin
  if (stdin.isTTY !== true) return makeLineTerminal()

  const tty = stdin as unknown as {
    setRawMode(m: boolean): void
    resume(): void
    pause(): void
    setEncoding(e: string): void
    once(ev: "data", cb: (chunk: unknown) => void): void
  }
  tty.setRawMode(true)
  tty.resume()
  tty.setEncoding("utf8")

  let pending = ""
  const readChar = (): Promise<string> => {
    if (pending.length > 0) {
      const c = pending[0]
      pending = pending.slice(1)
      return Promise.resolve(c)
    }
    return new Promise<string>((resolve) => {
      tty.once("data", (chunk) => {
        const s = String(chunk)
        pending = s.slice(1)
        resolve(s[0] ?? "")
      })
    })
  }

  const close = (): void => {
    try {
      tty.setRawMode(false)
    } catch {
      /* already closed */
    }
    tty.pause()
  }
  const abortOnCtrlC = (ch: string): void => {
    if (ch === "\x03") {
      process.stdout.write("\n")
      close()
      process.exit(130)
    }
  }

  return {
    async key(prompt) {
      process.stdout.write(prompt)
      const ch = await readChar()
      abortOnCtrlC(ch)
      const norm = ch === "\r" || ch === "\n" ? "" : ch
      process.stdout.write((norm || "⏎") + "\n") // echo the keystroke
      return norm
    },
    async line(prompt) {
      process.stdout.write(prompt)
      let buf = ""
      for (;;) {
        const ch = await readChar()
        abortOnCtrlC(ch)
        if (ch === "\r" || ch === "\n") {
          process.stdout.write("\n")
          return buf
        }
        if (ch === "\x7f" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1)
            process.stdout.write("\b \b")
          }
          continue
        }
        buf += ch
        process.stdout.write(ch)
      }
    },
    close,
  }
}

async function runReview(rest: string[]): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log(
      "Note: stdin is not a terminal. Interactive review needs a TTY — the `--filter`\n" +
        "wrapper captures stdin, so it will exit immediately. Run it directly instead:\n" +
        "    cd pkg/content && bun run surface review " + (rest[0] && !rest[0].startsWith("--") ? rest[0] : "<date>") + "\n" +
        "(Piped input still works for scripting.)\n",
    )
  }

  const { findKnown } = await import("./surface/known")
  const { discover } = await import("./surface/discover")
  const { reviewKnown, reviewClusters, annotationKey, dedupeForReview } = await import("./surface/interactive")
  const { judgeSession } = await import("./surface/judge")
  const { readSession, listSessionDates } = await import("./surface/tokens")
  const { buildLexicon } = await import("./lib/lexicon")
  const { addCorrection } = await import("./lib/defs")
  const { loadCorrections } = await import("./lib/corrections")
  const { foldForMatch } = await import("./lib/normalize")

  const useJudge = rest.includes("--judge")

  const lex = await buildLexicon()
  const term = await makeTerminal()
  const deps: ReviewDeps = {
    key: (q) => term.key(q),
    line: (q) => term.line(q),
    apply: (canonical, span) => addCorrection(canonical, span),
    out: (s) => console.log(s),
  }

  const totals = { reviewed: 0, approved: 0, applied: 0, denied: 0 }
  const add = (s: { reviewed: number; approved: number; applied: number; denied: number }): void => {
    totals.reviewed += s.reviewed
    totals.approved += s.approved
    totals.applied += s.applied
    totals.denied += s.denied
  }

  try {
    if (rest.includes("--discover")) {
      const mi = rest.indexOf("--min-count")
      const minCount = mi >= 0 ? Number(rest[mi + 1]) : undefined
      add(await reviewClusters(await discover(lex, { minCount }), deps))
    } else {
      const target = rest.find((a) => !a.startsWith("--")) ?? "all"
      const dates = target === "all" ? await listSessionDates() : [target]
      // Skip spans already corrected in defs.yaml, and any span handled earlier in
      // this review (across all sessions) so the same correction never re-prompts.
      const replace = await loadCorrections()
      const seen = new Set<string>()
      for (const date of dates) {
        const t = await readSession(date)
        if (!t) {
          log.warn(`no session "${date}"`)
          continue
        }
        const items = dedupeForReview(findKnown(t, lex), seen, foldForMatch, (span) => replace(span) !== span)
        if (items.length === 0) continue
        console.log(color.bold(color.cyan(`\n=== ${date} ===`)))

        let annotations: Annotations | undefined
        if (useJudge && items.length > 0) {
          console.log(color.dim("  (consulting LLM judge…)"))
          const verdicts = await judgeSession(t, items.map((c) => ({ lineRef: c.lineRef, span: c.span })), lex)
          annotations = new Map(
            verdicts.map((v) => [
              annotationKey(v.lineRef, v.span),
              {
                verdict: v.verdict,
                confidence: v.confidence,
                reason: v.reason,
                suggestedCanonical: v.suggestedCanonical,
              },
            ]),
          )
        }

        const stats = await reviewKnown(items, deps, annotations)
        add(stats)
        if (stats.quit) break
      }
    }
  } finally {
    term.close()
  }

  console.log(
    `\n${color.bold("Done")} — ${color.green(`${totals.applied} written`)} to defs.yaml ` +
      `(${color.green(`${totals.approved} approved`)}, ${color.yellow(`${totals.denied} denied`)}, ` +
      `${totals.reviewed} reviewed).`,
  )
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
    case "review":
      await runReview(rest)
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
