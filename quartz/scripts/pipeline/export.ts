import fs from "node:fs/promises"
import path from "node:path"
import { dataDir, scriptContentDir } from "../lib/paths"
import { walkContent } from "../lib/content"
import { buildLinker } from "../lib/linker"
import { loadCampaigns, matchCampaign, type MatchedCampaign } from "../lib/campaigns"
import { log } from "../lib/log"
import { podcast } from "../config"
import type { Transcript } from "../lib/types"

/** Subfolder of content/Script/ for transcripts that match no campaign. */
const UNSORTED_FOLDER = "Unsorted"

/** Normalize a `year-month-day` date to a non-padded canonical form, so a
 * transcript date and an episodes.json key for the same day always match
 * regardless of zero-padding (e.g. "2026-05-25" and "2026-5-25"). */
function normalizeDate(date: string): string {
  return date
    .split("-")
    .map((part) => String(Number(part)))
    .join("-")
}

/** One podcast episode entry from episodes.json. */
interface PodcastEpisode {
  link: string
  title: string
}

/** Load the external date→podcast-episode map, keyed by normalized date. Returns
 * an empty map (and logs) if the file is absent or unparseable, so a missing
 * podcast feed never breaks the export. Accepts both the current object shape
 * (`{ link, title }`) and the legacy bare-URL string for resilience; entries
 * without a usable link are skipped. */
async function getPodcastEpisodes(): Promise<Map<string, PodcastEpisode>> {
  const map = new Map<string, PodcastEpisode>()
  let raw: string
  try {
    raw = await fs.readFile(podcast.episodesPath, { encoding: "utf8" })
  } catch {
    log.info(`export: no podcast episodes file at ${podcast.episodesPath} — skipping links`)
    return map
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const [date, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        map.set(normalizeDate(date), { link: value, title: "" })
      } else if (
        value &&
        typeof value === "object" &&
        typeof (value as PodcastEpisode).link === "string"
      ) {
        const { link, title } = value as PodcastEpisode
        map.set(normalizeDate(date), { link, title: typeof title === "string" ? title : "" })
      }
    }
  } catch {
    log.warn(`export: could not parse ${podcast.episodesPath} — skipping podcast links`)
  }
  return map
}

async function getScripts(): Promise<Transcript[]> {
  const files = await fs.readdir(dataDir)

  const res: Transcript[] = []
  for (const file of files) {
    const contents = await fs.readFile(path.join(dataDir, file), { encoding: "utf8" })
    res.push(JSON.parse(contents))
  }

  return res
}

/** The character a player is billed as in this session, or their real name if
 * the session matched no campaign (or the speaker isn't a billed player). */
function characterFor(realName: string, match: MatchedCampaign | null): string {
  return match?.billing[realName]?.name ?? realName
}

export async function run(): Promise<void> {
  // content/Script/ is wholly generated: wipe it so renamed/refoldered pages
  // (e.g. a session that changes campaign folder) never leave a stale file
  // behind. Done before walkContent so the auto-linker corpus excludes the
  // transcripts we're about to regenerate.
  await fs.rm(scriptContentDir, { recursive: true, force: true })
  await fs.mkdir(scriptContentDir, { recursive: true })

  const docs = await walkContent()
  const link = buildLinker(docs)
  const scripts = await getScripts()
  const campaigns = await loadCampaigns()
  const episodes = await getPodcastEpisodes()
  log.info(`export: rendering ${scripts.length} transcript page(s)`)

  for (const transcript of scripts) {
    const { date, audio, script } = transcript

    // Route each session into a per-campaign folder; unmatched sessions land in
    // Unsorted/. The folder name is the campaign's display name (Quartz slug
    // logic turns it into the URL segment downstream).
    const match = matchCampaign(transcript, campaigns)
    const folder = match ? match.campaign.name : UNSORTED_FOLDER
    const outDir = path.join(scriptContentDir, folder)
    await fs.mkdir(outDir, { recursive: true })

    // Emit semantic markdown: frontmatter, an audio directive, and one
    // container directive per line. The remark-transcript plugin builds the DOM
    // at site-build time; the shared <style>/<script> live in custom.scss and
    // TranscriptPlayer.tsx. `link()` still inserts [[wikilinks]] from plain
    // mentions — remark-wikilinks resolves them downstream. Each line carries
    // both the real speaker (`user`, stable id for colors/filters/deep-links)
    // and the campaign character (`char`) so the player can toggle the label.
    const lines = [
      "---",
      "tags:",
      "  - Script",
      "---",
      "",
      `::transcript-audio{date="${date}" audio="${audio}"}`,
      "",
    ]

    // If a podcast episode covers this session, point to it under the player.
    const episode = episodes.get(normalizeDate(date))
    if (episode) {
      const linkText = episode.title || "Listen here"
      lines.push("> [!tip] Podcast")
      lines.push(`> A podcast episode covers this session: [${linkText}](${episode.link})`)
      lines.push("")
    }

    for (const {
      start,
      second,
      text,
      user: { name },
    } of script) {
      const char = characterFor(name, match)
      lines.push(
        `:::transcript-line{second="${second}" user="${name}" char="${char}" start="${start}"}`,
      )
      lines.push(link(text))
      lines.push(":::")
      lines.push("")
    }

    await fs.writeFile(path.join(outDir, `${date}.md`), lines.join("\n"))
  }
}
