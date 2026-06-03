import type { Speaker } from "./types"

// Authoritative mapping from recording user IDs to display names. This is the
// single source of truth that previously lived as a switch statement in
// ingest.js. (The color CSS in export/review references the same variable
// names below.)
const userToName: Record<string, string> = {
  jbassin: "Josh",
  iiri__: "Josh",
  boiledpacakes: "Jorge",
  miked6187: "Mike",
  nnaiman: "Noah",
  tanner_kn: "Tanner",
  tanner: "Tanner",
}

// Display name -> CSS color variable.
const nameToColor: Record<string, string> = {
  Josh: "--textJosh",
  Jorge: "--textJorge",
  Mike: "--textMike",
  Noah: "--textNoah",
  Tanner: "--textTanner",
}

const GUEST_COLOR = "--textGuest"

/**
 * Resolve a recording user ID to a display name and color. Unknown users keep
 * their raw ID as the name and get the guest color (matching the previous
 * default branch in ingest.js).
 */
export function resolveSpeaker(userId: string): Speaker {
  const name = userToName[userId] ?? userId
  const color = nameToColor[name] ?? GUEST_COLOR
  return { name, color }
}
