import fs from "node:fs/promises"
import yaml from "js-yaml"
import { campaignsPath } from "./paths"
import { campaign as campaignCfg } from "../config"
import type { Campaign, CharacterRole, Transcript } from "./types"

const GM_NAMES = new Set(["Gamemaster", "Dungeon Master"])

/** A campaign matched to a transcript, with the inferred player→character billing. */
export interface MatchedCampaign {
  campaign: Campaign
  /** Position in the campaign list; drives the output filename prefix. */
  idx: number
  /** player → the single character they are billed as in this session. */
  billing: Record<string, CharacterRole>
}

export async function loadCampaigns(): Promise<Campaign[]> {
  const raw = await fs.readFile(campaignsPath, { encoding: "utf8" })
  return (yaml.load(raw) ?? []) as Campaign[]
}

/** All non-GM character names across a campaign (the keyword set for matching). */
function characterNames(campaign: Campaign): string[] {
  const res: string[] = []
  for (const player in campaign.roles) {
    for (const { name } of campaign.roles[player]) {
      if (!GM_NAMES.has(name)) res.push(name)
    }
  }
  return res
}

/**
 * Find the first campaign whose character names appear in the transcript often
 * enough to clear the match threshold, and infer which character each player
 * is billed as (the one with the most keyword hits). Returns null if no
 * campaign matches.
 */
export function matchCampaign(
  transcript: Transcript,
  campaigns: Campaign[],
): MatchedCampaign | null {
  let idx = 0
  for (const campaign of campaigns) {
    const position = idx
    idx += 1

    const keywords = characterNames(campaign)
    const hits: Record<string, number> = {}
    for (const { text } of transcript.script) {
      for (const keyword of keywords) {
        if (hits[keyword] === undefined) hits[keyword] = 0
        if (text.includes(keyword)) hits[keyword] += 1
      }
    }

    let sum = 0
    for (const k in hits) sum += hits[k]
    if (sum < campaignCfg.matchThreshold) continue

    const billing: Record<string, CharacterRole> = {}
    for (const player in campaign.roles) {
      let max: string | null = null
      let best = -1
      for (const { name } of campaign.roles[player]) {
        const h = hits[name]
        if (h !== undefined && h > best) {
          max = name
          best = h
        }
      }
      for (const role of campaign.roles[player]) {
        if (role.name === max || GM_NAMES.has(role.name)) {
          billing[player] = role
          break
        }
      }
    }

    return { campaign, idx: position, billing }
  }

  return null
}

/** Output filename stem, e.g. "000.through-a-song-darkly". */
export function campaignFilename(m: MatchedCampaign): string {
  const ident = m.campaign.isMain ? "0" : "1"
  const idx = String(m.idx).padStart(2, "0")
  const name = m.campaign.name.toLowerCase().replaceAll(" ", "-").replaceAll(",", "")
  return `${ident}${idx}.${name}`
}

/**
 * Render a character description. A single-entry description renders inline; a
 * multi-entry description renders as an indented dash list. This reproduces the
 * original Shibboleth behavior, where multi-fact descriptions were authored via
 * a helper that produced "\n    - fact" lines and single facts were plain
 * strings.
 */
function renderDesc(desc: string[]): string {
  if (desc.length === 1) return desc[0]
  return desc.map((x) => `\n    - ${x}`).join("")
}

export function makeBilling(m: MatchedCampaign): string {
  const billings: string[] = []
  for (const player in m.billing) {
    const character = m.billing[player].name
    billings.push(`The role of ${character} is played by the player ${player}.`)
  }
  return ["Billing:\n", ...billings].join("\n")
}

export function makeContext(m: MatchedCampaign, date: string): string {
  const sessionKind = m.campaign.isMain
    ? `This is from the main campaign of the game, "${m.campaign.name}".`
    : `This is from a one-shot side story of the game, "${m.campaign.name}".`

  const descs: string[] = []
  for (const player in m.billing) {
    const { name, desc } = m.billing[player]
    if (GM_NAMES.has(name)) continue
    descs.push(`  - ${name}: ${renderDesc(desc)}`)
  }

  return `Context:

This is a transcript of an ongoing ttrpg game in the setting of Faerrin, recorded on ${date}. The four player characters are:
${descs.join("\n")}

${sessionKind}

The first portion of the transcript is a pre-session chat between the players, and then it transitions to the
actual session around when someone says something similar to "Do we want to play Pathfinder?" or "Does someone
want to do a recap?". The session ends when the Gamemaster says somthing similar to "Do we want to call it there
for the evening?" near the end of the transcript.

Note: transcription is machine-recorded, with an ${campaignCfg.transcriptionConfidence} confidence rate.
`
}

/**
 * Serialize campaigns back into the shibboleth.json shape (object keyed by
 * campaign name). This stays a generated artifact derived from campaigns.yaml.
 */
export function toShibbolethJson(
  campaigns: Campaign[],
): Record<string, { isMain: boolean; roles: Record<string, CharacterRole[]> }> {
  const out: Record<string, { isMain: boolean; roles: Record<string, CharacterRole[]> }> = {}
  for (const campaign of campaigns) {
    out[campaign.name] = { isMain: campaign.isMain, roles: campaign.roles }
  }
  return out
}
