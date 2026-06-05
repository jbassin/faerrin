// defs.yaml write-back, shared by the review UI and the Phase-2 judge.
//
// defs.yaml maps a canonical form -> list of mistranscriptions, authored as REGEX
// FRAGMENTS (corrections.ts wraps each in \b...\b). So a literal span discovered by
// the tool (or selected in the UI) must be regex-escaped before storing, and we
// generalize inter-word whitespace to \s* so one entry covers spacing variants.

import fs from "node:fs/promises"
import yaml from "js-yaml"
import { defsPath } from "./paths"

/** Escape regex metacharacters (mirrors linker.ts's escapeRegex). */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Convert a literal mistranscription span into a stored regex fragment. */
export function toFragment(span: string): string {
  return span
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join("\\s*")
}

function matchesLiteral(fragment: string, span: string): boolean {
  try {
    return new RegExp(`^(?:${fragment})$`, "i").test(span.trim())
  } catch {
    return false
  }
}

export interface AddResult {
  added: boolean
  reason?: string
}

/**
 * Append a mistranscription `span` under `canonical` in defs.yaml. Safe + idempotent:
 *  - skips an empty span or a span equal (folded) to the canonical;
 *  - skips a fragment already present, or one whose existing pattern already matches;
 *  - regex-escapes + space-generalizes the literal span.
 * Pass `doc` to mutate an in-memory document instead of touching disk (tests).
 */
export async function addCorrection(
  canonical: string,
  span: string,
  doc?: Record<string, string[]>,
): Promise<AddResult> {
  const fragment = toFragment(span)
  if (!fragment) return { added: false, reason: "empty span" }
  if (fragment.toLowerCase() === canonical.toLowerCase()) {
    return { added: false, reason: "variant equals canonical" }
  }

  const onDisk = doc === undefined
  const document = doc ?? ((yaml.load(await fs.readFile(defsPath, "utf8")) ?? {}) as Record<string, string[]>)

  const list = Array.isArray(document[canonical]) ? document[canonical] : []
  if (list.includes(fragment)) return { added: false, reason: "duplicate" }
  if (list.some((f) => matchesLiteral(f, span))) return { added: false, reason: "already covered" }

  list.push(fragment)
  document[canonical] = list

  if (onDisk) await fs.writeFile(defsPath, yaml.dump(document, { lineWidth: -1 }))
  return { added: true }
}
