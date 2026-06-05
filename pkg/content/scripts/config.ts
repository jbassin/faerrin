// Central, typed configuration for the content pipeline.
// Operational values live here; large human-edited data lives in YAML
// (defs.yaml for corrections, campaigns.yaml for campaign/character config).

import { resolve } from "node:path";
import { sharedRoot } from "./lib/paths";

export const remote = {
  /** Base URL of the transcript/audio API consumed by `ingest`. */
  baseUrl: "https://static-audio.iridi.cc/",
  /** Top-level remote directories to skip during ingest. */
  skipDirs: ["bookz"],
  /** Per-request timeout for remote JSON fetches. */
  fetchTimeoutMs: 15_000,
  /** Number of attempts (including the first) before giving up on a fetch. */
  fetchRetries: 3,
  /** Base backoff between retries, in milliseconds (multiplied by attempt). */
  retryBackoffMs: 500,
}

export const ingest = {
  /**
   * Where `ingest` reads sessions from: the static-audio host ("remote",
   * default) or a local `wretch` output dir ("local"). Override with
   * INGEST_SOURCE. The "local" path reads transcripts off the filesystem (the
   * in-repo producer) instead of over HTTP — the migration's re-wired seam. The
   * audio URL is unchanged either way (the mp3 stays served from `remote.baseUrl`).
   */
  source: (process.env.INGEST_SOURCE === "local" ? "local" : "remote") as
    | "remote"
    | "local",
  /**
   * For source="local": the `@faerrin/wretch` package's `saved/` dir — one subdir
   * per session date, each holding `script.json` (+ `audio.mp3`). Override with
   * INGEST_SAVED_DIR. Defaults to the in-repo wretch output.
   */
  savedDir:
    process.env.INGEST_SAVED_DIR ?? resolve(sharedRoot, "..", "wretch", "data", "saved"),
}

export const site = {
  /** Public base URL of the built site, used in generated audio-deeplink JS. */
  baseUrl: "https://heart.iridi.cc",
}

export const review = {
  /** Port for the local transcript-correction review server. */
  port: Number(process.env.REVIEW_PORT ?? 10116),
}

export const podcast = {
  /**
   * Path to the in-repo `@faerrin/face` `episodes.json` mapping a session date
   * (year-month-day, non-padded — matching the transcript `date` field) to a
   * podcast episode (`{ link, title }`). Defaults to the face build output
   * (`pkg/face/dist/episodes.json`); overridable via env. `export` adds a
   * podcast link to any Script page whose date is present here. Missing file (e.g.
   * face not built yet) → no links emitted (silently skipped).
   */
  episodesPath:
    process.env.PODCAST_EPISODES_PATH ??
    resolve(sharedRoot, "..", "face", "dist", "episodes.json"),
}

export const surface = {
  /** Max n-gram width when scanning lines for multi-word canonicals. */
  maxNgram: 3,
  /** Skip tokens shorter than this (1–2 char noise). */
  minTokenLen: 3,
  /** Mode 1: min ensemble score to surface a single-word correction candidate. */
  knownFloorUnigram: 0.78,
  /** Mode 1: min ensemble score for a multi-word candidate. */
  knownFloorMulti: 0.8,
  /**
   * Mode 1: a candidate also needs a "namelike" (capitalized, non-line-initial)
   * token — proper-noun garbles are capitalized; the common false positives are
   * lowercase function words or sentence-initial words. A unigram may skip this
   * gate only if its match is extremely strong (≥ this score).
   */
  strongScore: 0.88,
  /**
   * Mode 2: a token within this score of a known canonical is treated as a
   * Mode-1 garble (already attributable) and excluded from new-entity discovery.
   */
  knownNearFloor: 0.6,
  /** Mode 2: min occurrences across all sessions for a cluster to surface. */
  minClusterCount: 3,
  /** Mode 2: attach an OOV variant to a cluster when ensembleSim ≥ this (leader clustering). */
  clusterMergeFloor: 0.72,
}

export const campaign = {
  /**
   * Minimum number of character-name keyword hits in a transcript before it is
   * matched to a campaign. Below this, the transcript is treated as unmatched.
   */
  matchThreshold: 15,
  /** Confidence note embedded in generated LLM context headers. */
  transcriptionConfidence: "85%",
}
