import fs from "node:fs/promises"
import path from "node:path"
import { dataDir, scriptOutDir, shibbolethJsonPath } from "../lib/paths"
import {
  loadCampaigns,
  matchCampaign,
  campaignFilename,
  makeBilling,
  makeContext,
  toShibbolethJson,
  type MatchedCampaign,
} from "../lib/campaigns"
import { log } from "../lib/log"
import type { Campaign, Transcript } from "../lib/types"

const BARRIER = "---"

interface MatchedTranscript {
  transcript: Transcript
  match: MatchedCampaign
}

async function getMatchedScripts(campaigns: Campaign[]): Promise<MatchedTranscript[]> {
  const files = await fs.readdir(dataDir)

  const res: MatchedTranscript[] = []
  for (const file of files) {
    const transcript = JSON.parse(
      await fs.readFile(path.join(dataDir, file), { encoding: "utf8" }),
    ) as Transcript
    const match = matchCampaign(transcript, campaigns)
    if (match !== null) {
      res.push({ transcript, match })
    }
  }

  res.sort((a, b) => new Date(a.transcript.date).getTime() - new Date(b.transcript.date).getTime())
  return res
}

export async function run(): Promise<void> {
  const campaigns = await loadCampaigns()

  // shibboleth.json is a generated artifact derived from campaigns.yaml.
  await fs.writeFile(shibbolethJsonPath, JSON.stringify(toShibbolethJson(campaigns), null, 2))

  const matched = await getMatchedScripts(campaigns)
  for (const { transcript, match } of matched) {
    const lines = transcript.script.map(
      ({ text, user: { name } }) => `> ${match.billing[name].name}: ${text}  `,
    )

    const complete = [
      makeContext(match, transcript.date),
      BARRIER,
      makeBilling(match),
      BARRIER,
      "Script:\n",
      ...lines,
    ].join("\n")

    await fs.writeFile(
      path.join(scriptOutDir, `${campaignFilename(match)}.${transcript.date}.txt`),
      complete,
    )
  }

  log.info(`script: wrote ${matched.length} campaign transcript(s)`)
}
