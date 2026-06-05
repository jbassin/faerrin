// Single source of truth for who counts as a player lives in content's
// roster (the same map ingest uses to resolve display names). Re-export it here
// so the wretch pipeline filters tracks against one authoritative list instead
// of the old, duplicated PLAYERS map in python/consts.py.
export { isPlayer } from "../../content/scripts/lib/roster.ts"
