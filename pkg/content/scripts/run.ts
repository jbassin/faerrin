import { log } from "./lib/log"

// Pipeline steps, in production run order. Each lazily imports its module so a
// single-step run doesn't load the others.
const STEPS: Record<string, () => Promise<void>> = {
  ingest: () => import("./pipeline/ingest").then((m) => m.run()),
  export: () => import("./pipeline/export").then((m) => m.run()),
  script: () => import("./pipeline/script").then((m) => m.run()),
}

const ALL = ["ingest", "export", "script"]

function usage(): void {
  console.log(`Usage: tsx scripts/run.ts [step]

  step   one of: ${ALL.join(", ")}, or "all" (default)

Runs the content pipeline. With no argument (or "all") runs every step in order.`)
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? "all"
  if (arg === "-h" || arg === "--help") {
    usage()
    return
  }

  const steps = arg === "all" ? ALL : [arg]
  for (const step of steps) {
    const fn = STEPS[step]
    if (!fn) {
      log.error(`unknown step "${step}". valid: ${ALL.join(", ")}, all`)
      process.exit(1)
    }
    log.info(`▶ ${step}`)
    const started = Date.now()
    await fn()
    log.info(`✓ ${step} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
