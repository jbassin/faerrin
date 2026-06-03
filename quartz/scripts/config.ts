// Central, typed configuration for the content pipeline.
// Operational values live here; large human-edited data lives in YAML
// (defs.yaml for corrections, campaigns.yaml for campaign/character config).

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
   * Path to the external `episodes.json` mapping a session date
   * (year-month-day, non-padded — matching the transcript `date` field) to a
   * podcast episode (`{ link, title }`). Lives outside this repo, so it is
   * overridable via env; `export` adds a podcast link to any Script page whose
   * date is present here. Missing file → no links emitted (silently skipped).
   */
  episodesPath:
    process.env.PODCAST_EPISODES_PATH ?? "/ruby/data/experiments/caster/site/dist/episodes.json",
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
