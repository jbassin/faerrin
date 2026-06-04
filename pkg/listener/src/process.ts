import fs from "node:fs"
import path from "node:path"

import { SoundStack } from "./soundStack.ts"
import { username, date as parseDate } from "./fileData.ts"
import { isPlayer } from "./roster.ts"
import { loadProcessed, saveProcessed } from "./state.ts"
import { mergeAudio } from "./audio.ts"
import { transcribe } from "./transcribe.ts"
import { run } from "./exec.ts"
import { dataPath, tmpPath, incomingPath, stateFile, pythonDir } from "./paths.ts"
import type { Segment } from "./types.ts"

// Hybrid orchestrator: the TS side of the listener pipeline. Watches Craig zips,
// merges audio (ffmpeg), delegates transcription to python/transcribe.py
// (whisperx), assembles the per-user segments into one ordered script.json, and
// publishes to data/saved/{date}/. Set LISTENER_KEEP_ZIP=1 to preserve source
// zips (handy when validating against real recordings).

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

function playerTracks(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".aac"))
    .filter((n) => isPlayer(username(path.basename(n, ".aac"))))
    .map((n) => path.join(dir, n))
}

function processZip(zipPath: string): boolean {
  const stem = path.basename(zipPath, ".zip")
  const sessionDate = parseDate(stem)
  if (sessionDate === "") {
    log(`skipping ${stem}: could not parse a date from the zip name`)
    return false
  }

  log(`processing ${stem} -> session ${sessionDate}`)
  fs.mkdirSync(tmpPath, { recursive: true })
  const work = fs.mkdtempSync(path.join(tmpPath, "session-"))

  try {
    run("unzip", ["-o", "-q", zipPath, "-d", work])

    const tracks = playerTracks(work)
    if (tracks.length === 0) {
      log(`no player tracks found in ${stem}; skipping`)
      return false
    }
    log(`found ${tracks.length} player track(s)`)

    const outDir = path.join(dataPath, "saved", sessionDate)
    fs.mkdirSync(outDir, { recursive: true })

    log("merging audio (ffmpeg)")
    mergeAudio(tracks, path.join(outDir, "audio.mp3"))

    log("transcribing (whisperx — the slow step)")
    transcribe(pythonDir, outDir, tracks)

    log("assembling script.json")
    const stack = new SoundStack()
    for (const track of tracks) {
      const trackStem = path.basename(track, ".aac")
      const segPath = path.join(outDir, `${trackStem}.json`)
      const segments = JSON.parse(fs.readFileSync(segPath, "utf8")) as Segment[]
      stack.add(username(trackStem), segments)
    }
    fs.writeFileSync(path.join(outDir, "script.json"), JSON.stringify(stack.drain()))

    // Archive the raw player tracks alongside the output (mirrors the original
    // saved/{date}/ layout).
    for (const track of tracks) {
      fs.renameSync(track, path.join(outDir, path.basename(track)))
    }

    log(`done: ${outDir}`)
    return true
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

function main(): void {
  log(`incoming=${incomingPath}`)
  log(`data=${dataPath}`)

  const zips = listZips(incomingPath)
  const processed = loadProcessed(stateFile)
  const todo = zips.filter((z) => !processed.has(path.basename(z)))
  log(`found ${zips.length} zip(s), ${todo.length} unprocessed`)

  for (const zip of todo) {
    const name = path.basename(zip)
    try {
      processZip(zip)
      processed.add(name)
      saveProcessed(stateFile, processed)
      if (process.env.LISTENER_KEEP_ZIP !== "1") fs.rmSync(zip, { force: true })
    } catch (err) {
      log(`ERROR processing ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

main()
