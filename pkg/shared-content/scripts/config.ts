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
   * default) or a local `listener` output dir ("local"). Override with
   * INGEST_SOURCE. The "local" path reads transcripts off the filesystem (the
   * in-repo producer) instead of over HTTP — the migration's re-wired seam. The
   * audio URL is unchanged either way (the mp3 stays served from `remote.baseUrl`).
   */
  source: (process.env.INGEST_SOURCE === "local" ? "local" : "remote") as
    | "remote"
    | "local",
  /**
   * For source="local": the `listener` package's `saved/` dir — one subdir per
   * session date, each holding `script.json` (+ `audio.mp3`). Override with
   * INGEST_SAVED_DIR. Defaults to the in-repo listener output.
   */
  savedDir:
    process.env.INGEST_SAVED_DIR ?? resolve(sharedRoot, "..", "listener", "data", "saved"),
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
   * Path to the in-repo caster-site `episodes.json` mapping a session date
   * (year-month-day, non-padded — matching the transcript `date` field) to a
   * podcast episode (`{ link, title }`). Defaults to the caster-site build output
   * (`pkg/caster/site/dist/episodes.json`); overridable via env. `export` adds a
   * podcast link to any Script page whose date is present here. Missing file (e.g.
   * caster-site not built yet) → no links emitted (silently skipped).
   */
  episodesPath:
    process.env.PODCAST_EPISODES_PATH ??
    resolve(sharedRoot, "..", "caster", "site", "dist", "episodes.json"),
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
