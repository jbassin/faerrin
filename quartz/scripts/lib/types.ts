// Shared domain types for the content pipeline.

/** A raw transcript line as returned by the remote API. */
export interface RawLine {
  start: number
  end: number
  user: string
  text: string
}

/** A resolved speaker: display name plus the CSS color variable for it. */
export interface Speaker {
  name: string
  color: string
}

/** A transcript line after ingest formatting. */
export interface FormattedLine {
  start: string
  second: number
  text: string
  user: Speaker
  duration: number
}

/** A full session transcript, as stored in scripts/data/<date>.json. */
export interface Transcript {
  date: string
  audio: string
  script: FormattedLine[]
}

/** A parsed wiki content file under content/. */
export interface ContentDoc {
  /** Path relative to content/, e.g. "People/Anouk.md". */
  file: string
  /** Parsed frontmatter. */
  data: Record<string, unknown>
  /** Body markdown with frontmatter stripped. */
  content: string
  /** Basename without extension, e.g. "Anouk". */
  filename: string
  /** Display title (frontmatter title, else filename, else "" for index files). */
  title: string
  /** Names/aliases used for auto-linking (filename, title, aliases). */
  names: string[]
  /** Lowercased path slug used by the knowledge/upload steps. */
  dirSlug: string
}

/** A character a player can be billed as within a campaign. */
export interface CharacterRole {
  name: string
  desc: string[]
}

/** A campaign definition (one entry of campaigns.yaml). */
export interface Campaign {
  name: string
  isMain: boolean
  roles: Record<string, CharacterRole[]>
}
