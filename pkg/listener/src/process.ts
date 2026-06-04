import fs from "node:fs"
import path from "node:path"

import { SoundStack } from "./soundStack.ts"
import { username, date as parseDate } from "./fileData.ts"
import { isPlayer } from "./roster.ts"
import { mergeAudio } from "./audio.ts"
import { transcribe } from "./transcribe.ts"
import { run, runOk } from "./exec.ts"
import { writeAtomic } from "./fsx.ts"
import { dataPath, tmpPath, incomingPath, pythonDir } from "./paths.ts"
import type { Segment } from "./types.ts"

// Reconciler for the listener stage. It is *level-triggered*: each run observes
// desired state (Craig zips present) vs actual state (saved/{date}/script.json
// present) and materializes the gap — no persisted job state, so any trigger
// (cron, systemd .path, manual) can call reconcile() at any time, idempotently.
// The expensive transcription node is the only one with resume discipline; the
// cheap downstream rebuild (ingest/caster/quartz) is left to the cutover.
//
// LISTENER_KEEP_ZIP=1 preserves source zips (handy when validating).

function log(msg: string): void {
  console.log(`[listener] ${msg}`)
}

function listZips(dir: string): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    log(`incoming dir not readable: ${dir}`)
    return []
  }
  return names.filter((n) => n.endsWith(".zip")).map((n) => path.join(dir, n))
}

interface Pending {
  zip: string
  date: string
}

// Disk is the ledger: a session needs work iff its zip parses to a date and no
// saved/{date}/script.json exists yet. Pure over the filesystem — unit-tested.
export function pendingSessions(zips: string[], data: string): Pending[] {
  const out: Pending[] = []
  for (const zip of zips) {
    const date = parseDate(path.basename(zip, ".zip"))
    if (date === "") continue
    if (fs.existsSync(path.join(data, "saved", date, "script.json"))) continue
    out.push({ zip, date })
  }
  return out
}

// Readiness gate: a zip that passes `unzip -t` is fully landed and intact. This
// survives synced/FUSE drives where inotify CLOSE_WRITE and lsof are unreliable.
function ready(zip: string): boolean {
  return runOk("unzip", ["-t", "-qq", zip])
}

function playerTracks(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".aac"))
    .filter((n) => isPlayer(username(path.basename(n, ".aac"))))
    .map((n) => path.join(dir, n))
}

// Single-flight lock so overlapping triggers can't double-run the multi-hour
// transcription. Stale locks (older than 12h — longer than any real run) are
// reclaimed.
function acquireLock(): number | null {
  fs.mkdirSync(dataPath, { recursive: true })
  const lockPath = path.join(dataPath, ".reconcile.lock")
  try {
    const fd = fs.openSync(lockPath, "wx")
    fs.writeSync(fd, String(process.pid))
    return fd
  } catch {
    try {
      const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs
      if (ageMs > 12 * 3600_000) {
        fs.rmSync(lockPath, { force: true })
        return acquireLock()
      }
    } catch {
      // lock vanished between open and stat — retry once
      return acquireLock()
    }
    return null
  }
}

function releaseLock(fd: number): void {
  try {
    fs.closeSync(fd)
  } catch {}
  try {
    fs.rmSync(path.join(dataPath, ".reconcile.lock"), { force: true })
  } catch {}
}

// Materialize one session to completion. Each sub-step is independently
// skippable, so a crash + re-run resumes rather than redoing hours of work:
// audio.mp3 skips if present; finished tracks skip inside transcribe.py;
// script.json (written atomically, last) is the session-done sentinel.
function materializeSession(date: string, zip: string): "MATERIALIZED" | "EMPTY" {
  const outDir = path.join(dataPath, "saved", date)
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(tmpPath, { recursive: true })
  const work = fs.mkdtempSync(path.join(tmpPath, "session-"))

  try {
    run("unzip", ["-o", "-q", zip, "-d", work])

    const tracks = playerTracks(work)
    if (tracks.length === 0) {
      log(`no player tracks in ${date}`)
      return "EMPTY"
    }
    log(`found ${tracks.length} player track(s)`)

    const audioOut = path.join(outDir, "audio.mp3")
    if (fs.existsSync(audioOut)) {
      log("audio.mp3 exists — skip merge")
    } else {
      log("merging audio (ffmpeg)")
      const tmpAudio = `${audioOut}.tmp`
      mergeAudio(tracks, tmpAudio)
      fs.renameSync(tmpAudio, audioOut)
    }

    log("transcribing (whisperx — resumes already-finished tracks)")
    transcribe(pythonDir, outDir, tracks)

    log("assembling script.json")
    const stack = new SoundStack()
    for (const track of tracks) {
      const trackStem = path.basename(track, ".aac")
      const segments = JSON.parse(
        fs.readFileSync(path.join(outDir, `${trackStem}.json`), "utf8"),
      ) as Segment[]
      stack.add(username(trackStem), segments)
    }
    writeAtomic(path.join(outDir, "script.json"), JSON.stringify(stack.drain()))

    // Archive the raw player tracks alongside the output.
    for (const track of tracks) {
      fs.renameSync(track, path.join(outDir, path.basename(track)))
    }

    log(`done: ${outDir}`)
    return "MATERIALIZED"
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

// The cheap, already-idempotent tail (ingest -> export -> script, then caster
// podcast + quartz wiki builds). Wiring those cross-package builds is the Phase 4
// cutover (needs the INGEST_SOURCE=local flip + host validation), so for now we
// only signal that a rebuild is due.
function rebuildDownstream(n: number): void {
  log(`${n} new session(s) materialized — downstream rebuild pending (Phase 4 cutover)`)
}

export function reconcile(): void {
  const lock = acquireLock()
  if (lock === null) {
    log("another reconcile is running — exiting")
    return
  }

  try {
    const zips = listZips(incomingPath)
    const pending = pendingSessions(zips, dataPath)
    log(`incoming=${zips.length} zip(s), ${pending.length} needing transcription`)

    let materialized = 0
    for (const { zip, date } of pending) {
      if (!ready(zip)) {
        log(`not fully landed yet (unzip -t failed): ${path.basename(zip)}`)
        continue
      }
      try {
        log(`materializing session ${date}`)
        const res = materializeSession(date, zip)
        if (res === "MATERIALIZED") {
          materialized++
          if (process.env.LISTENER_KEEP_ZIP !== "1") fs.rmSync(zip, { force: true })
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        log(`ERROR materializing ${date}: ${reason}`)
        try {
          fs.writeFileSync(
            path.join(dataPath, "saved", date, ".failed"),
            `${new Date().toISOString()} ${reason}\n`,
          )
        } catch {}
      }
    }

    if (materialized > 0) rebuildDownstream(materialized)
    else log("no new sessions — nothing downstream to rebuild")
  } finally {
    releaseLock(lock)
  }
}

if (import.meta.main) reconcile()
