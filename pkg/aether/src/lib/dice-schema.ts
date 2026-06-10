/**
 * Shared data contract for the /dice dashboard (plan: thoughts/aether/plans/0001).
 *
 * This is the SINGLE SOURCE OF TRUTH for the shape of the artifacts the exporter
 * (`scripts/export-dice.ts`) writes into `assets/dice/` and the island
 * (`components/islands/DiceDashboard.tsx`) reads back. Both sides import these
 * types so the JSON can never silently drift.
 *
 * Artifacts:
 *   summary.json  → DiceSummary   (pre-aggregated viz feed; small)
 *   rolls.json    → DiceRoll[]     (compact raw rows; the "view everything" table)
 *   rolls.csv     → download       (timestamp,player,character,base,value,source)
 *   rolls.parquet → download       (same rows, columnar)
 *
 * All artifacts honor the filter `base <= BASE_CAP AND player_id NOT IN EXCLUDED`.
 * d1 (always 1) is counted in totals but excluded from luck/crit statistics.
 */

/** Filter constants — keep in lockstep with mouth's write-side guard (save_die). */
export const BASE_CAP = 100
export const EXCLUDED_PLAYER_IDS = [6] as const

/** A single normalized die roll. A dice POOL expands to one row per physical die. */
export interface DiceRoll {
  /** ISO timestamp (UTC, as stored by SQLite `datetime('now')`). */
  t: string
  /** Player display name (joined from players.toml). */
  p: string
  /** Die size / base, e.g. 20 for a d20. Always <= BASE_CAP. */
  b: number
  /** Value rolled, in 1..b. */
  v: number
}

/** Per-base statistics for one player. */
export interface BaseStats {
  base: number
  /** Dice rolled at this base (not roll commands). */
  count: number
  /** Observed arithmetic mean of the rolled values. */
  mean: number
  /** Expected mean of a fair die of this size: (base + 1) / 2. */
  expectedMean: number
  /** histogram[i] = count of rolls whose value === i + 1; length === base. */
  histogram: number[]
  /**
   * Crit/fumble = max-face / min-face hits. Only populated for variance-bearing
   * dice (base > 1); null otherwise (d1 has no variance).
   */
  crits: number | null
  fumbles: number | null
  critRate: number | null
  fumbleRate: number | null
  /** observed mean − expected mean (signed; >0 = lucky-high). */
  luckDeviation: number
  /**
   * z-score of the observed mean against a fair die:
   *   (mean − expectedMean) / sqrt(((base² − 1) / 12) / count)
   * A statistically honest "how surprising is this luck". null for d1.
   */
  luckZ: number | null
}

export interface PlayerSummary {
  playerId: number
  name: string
  character: string
  class: string
  /** Total dice rolled across all bases (includes d1). */
  totalRolls: number
  /** Keyed by base as a string (JSON object keys), e.g. "20", "6". */
  byBase: Record<string, BaseStats>
}

/** Monthly roll-count bucket (overall + per player) for the luck/usage-over-time charts. */
export interface TimelineBucket {
  /** 'YYYY-MM'. */
  period: string
  total: number
  /** player name → dice rolled in this period. */
  perPlayer: Record<string, number>
}

export interface LeaderEntry {
  name: string
  /** The ranked metric value (rate, count, or deviation depending on the board). */
  value: number
  /** Optional human-readable qualifier (e.g. "n=4950"). */
  detail?: string
}

export interface Leaderboards {
  /** By d20 observed-mean deviation, descending (luck-high) / ascending (luck-low). */
  luckiest: LeaderEntry[]
  unluckiest: LeaderEntry[]
  /** By d20 nat-20 count / nat-1 count. */
  mostCrits: LeaderEntry[]
  mostFumbles: LeaderEntry[]
  /** By total dice rolled. */
  mostRolls: LeaderEntry[]
}

export interface DiceMeta {
  /** ISO timestamp of when the export ran. */
  generatedAt: string
  /** Total dice rolled after filtering. */
  totalRolls: number
  dateRange: { from: string; to: string }
  /** Player names present, in leaderboard-friendly order. */
  players: string[]
  /** Distinct bases present, ascending. */
  bases: number[]
  filter: { baseCap: number; excludedPlayerIds: number[] }
}

/** The top-level `summary.json` shape. */
export interface DiceSummary {
  meta: DiceMeta
  perPlayer: PlayerSummary[]
  timeline: TimelineBucket[]
  leaderboards: Leaderboards
}
