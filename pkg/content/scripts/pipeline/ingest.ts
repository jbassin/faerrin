import fs from "node:fs/promises"
import path from "node:path"
import { remote, ingest as ingestCfg } from "../config"
import { dataDir } from "../lib/paths"
import { fetchJSON } from "../lib/http"
import { loadCorrections } from "../lib/corrections"
import { resolveSpeaker } from "../lib/roster"
import { log } from "../lib/log"
import type { RawLine, FormattedLine, Transcript } from "../lib/types"

interface RemoteDir {
  name: string
  url: string
}

interface ListedSession {
  date: string
  script: RawLine[]
  audio: string
}

function api<T>(fragment: string): Promise<T> {
  return fetchJSON<T>(remote.baseUrl + fragment)
}

async function getDirectories(): Promise<RemoteDir[]> {
  const listing = await api<{ name: string }[]>("")
  return listing.map(({ name }) => ({ name: name.replaceAll("/", ""), url: name }))
}

async function getListing(): Promise<ListedSession[]> {
  const dirs = await getDirectories()

  const res: ListedSession[] = []
  for (const { name, url } of dirs) {
    if (remote.skipDirs.includes(name)) continue

    try {
      const files = await api<{ name: string }[]>(url)
      if (!files.some((f) => f.name === "script.json")) continue

      const script = await api<RawLine[]>(`${url}script.json`)
      if (script.length === 0) continue

      res.push({ date: name, script, audio: `${remote.baseUrl}${url}audio.mp3` })
    } catch (err) {
      // Isolate failures so one bad session doesn't abort the whole ingest.
      const reason = err instanceof Error ? err.message : String(err)
      log.warn(`ingest: skipping session "${name}": ${reason}`)
    }
  }

  return res
}

// Local source: read each session's script.json straight off the wretch
// package's saved/ dir instead of over HTTP. The transform below is shared with
// the remote path, so output is byte-identical given identical script.json
// inputs — that equivalence is the migration's parity gate.
async function getLocalListing(): Promise<ListedSession[]> {
  const res: ListedSession[] = []

  let entries: string[]
  try {
    entries = await fs.readdir(ingestCfg.savedDir)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn(`ingest(local): cannot read ${ingestCfg.savedDir}: ${reason}`)
    return res
  }

  for (const name of entries.sort()) {
    if (remote.skipDirs.includes(name)) continue

    const scriptPath = path.join(ingestCfg.savedDir, name, "script.json")
    try {
      const script = JSON.parse(await fs.readFile(scriptPath, "utf8")) as RawLine[]
      if (script.length === 0) continue

      // Audio is still served over HTTP from the static host (the mp3 stays out
      // of the repo); only the transcript source moves local.
      res.push({ date: name, script, audio: `${remote.baseUrl}${name}/audio.mp3` })
    } catch {
      // No script.json here (or unreadable) — skip, mirroring the remote path's
      // "no script.json -> skip" behavior.
    }
  }

  return res
}

export async function run(): Promise<void> {
  const replace = await loadCorrections()
  const sessions =
    ingestCfg.source === "local" ? await getLocalListing() : await getListing()
  log.info(`ingest: source=${ingestCfg.source}, writing ${sessions.length} session(s) to ${dataDir}`)

  for (const { date, script, audio } of sessions) {
    const formatted: FormattedLine[] = script.map(({ start, end, user, text }) => ({
      start: new Date(start * 1000).toISOString().slice(11, 19),
      second: start,
      text: replace(text),
      user: resolveSpeaker(user),
      duration: parseFloat((end - start).toFixed(3)),
    }))

    const transcript: Transcript = { date, audio, script: formatted }
    await fs.writeFile(path.join(dataDir, `${date}.json`), JSON.stringify(transcript, null, 2))
  }
}
