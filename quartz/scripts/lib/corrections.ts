import fs from "node:fs/promises"
import yaml from "js-yaml"
import { defsPath } from "./paths"

export type Replacer = (input: string) => string

/**
 * Build the transcription-correction replacer from defs.yaml. Each key is a
 * correct form; its values are mis-transcriptions (authored as regex
 * fragments, so they are intentionally NOT escaped). The returned function
 * replaces any mis-transcription with its correct form and trims the result.
 */
export async function loadCorrections(): Promise<Replacer> {
  const contents = await fs.readFile(defsPath, { encoding: "utf8" })
  const doc = (yaml.load(contents) ?? {}) as Record<string, string[]>

  const patterns: string[] = []
  const mapping: string[] = []

  let idx = 0
  for (const key in doc) {
    for (const val of doc[key]) {
      patterns.push(String.raw`(?<s${idx}>\b${val}\b)`)
      mapping.push(key)
      idx += 1
    }
  }

  const pattern = new RegExp(patterns.join("|"), "gi")

  return (input: string): string =>
    input
      .replaceAll(pattern, (match: string, ...args: unknown[]): string => {
        for (let i = 0; i < args.length; i++) {
          if (args[i] !== undefined) {
            return mapping[i]
          }
        }
        return match
      })
      .trim()
}
