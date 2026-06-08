// Shared types for the Caster pipeline.
// Stage 1 (Ingest) produces Session + the wiki corpus; later stages consume them.
// See docs/discovery-and-definition.md §2.4 for the full stage contracts.

/** One diarized line from a transcript, with speaker resolution applied. */
export interface Turn {
  /** 1-based line number as recorded in the transcript (the NNNNNN prefix). */
  line: number;
  /** Raw diarized label: a character name or "Gamemaster". */
  speaker: string;
  /** Utterance text, trailing whitespace trimmed. */
  text: string;
  /** Resolved player real name; undefined when the label is unmapped for this arc. */
  player?: string;
  /** Resolved role; undefined when unmapped. */
  role?: SpeakerRole;
}

export type SpeakerRole = "gm" | "player";

/** A single parsed transcript file = one play session. */
export interface Session {
  /** Stable id, e.g. "105.observatory-slipped.2026-4-27". */
  id: string;
  /** Arc slug derived from the filename, e.g. "observatory-slipped". */
  arc: string;
  /** Arc prose title from shibboleth.json, e.g. "Observatory, Slipped" (undefined if unmatched). */
  arcTitle?: string;
  /** Whether this arc is the main campaign. */
  isMain: boolean;
  /** Session date as written in the filename, e.g. "2026-4-27". */
  date: string;
  /** Source file path. */
  path: string;
  turns: Turn[];
}

// --- Speaker map (content/shibboleth.json) ---------------------------------

/** Raw shape of content/shibboleth.json: arc prose title -> roster. */
export type Shibboleth = Record<string, ShibbolethArc>;

export interface ShibbolethArc {
  isMain: boolean;
  /** player real name -> the character(s) they play in this arc. */
  roles: Record<string, ShibbolethCharacter[]>;
}

export interface ShibbolethCharacter {
  name: string;
  desc: string[];
}

/** A resolved speaker, derived by inverting the shibboleth roster. */
export interface ResolvedSpeaker {
  player: string;
  role: SpeakerRole;
  desc: string[];
}

/**
 * Inverted, arc-scoped lookup built from the shibboleth at load time:
 *   arcSlug -> (characterName -> ResolvedSpeaker)
 * Arc-scoped on purpose: e.g. "Archie" maps to different players in different arcs.
 */
export type SpeakerIndex = Map<string, Map<string, ResolvedSpeaker>>;

// --- Wiki ------------------------------------------------------------------

/** A cleaned wiki page plus its outgoing wikilinks. */
export interface WikiPage {
  /** Path relative to content/wiki, e.g. "Geography/Calaria/Wrenford.md". */
  path: string;
  /** Frontmatter `title` if present, else derived from the filename. */
  title: string;
  /** Body text with frontmatter and embedded HTML stripped. */
  text: string;
  /** Raw link targets found as [[Target]] or [[Target|Alias]] (alias dropped). */
  links: string[];
}

/** The wiki corpus: pages keyed by relative path, plus the link graph. */
export interface WikiCorpus {
  pages: Map<string, WikiPage>;
  /** Adjacency: page path -> resolved page paths it links to. */
  graph: Map<string, string[]>;
}

// --- Stage 2: Distill -------------------------------------------------------

/** One in-world story beat distilled from a session transcript. */
export interface Beat {
  /** 1-based position in the session's narrative. */
  order: number;
  /** What happened, in-world. */
  summary: string;
  /**
   * Why this beat MATTERED: the stakes, tension, or consequences — what was at
   * risk, what it changed, why the table leaned in. The dramatic weight that
   * lets Stage 3 discuss the moment instead of just reciting it. Optional so
   * older digests (which lacked it) still parse; new distills always set it.
   */
  significance?: string;
  /**
   * Concrete, vivid texture worth talking about: a clutch or catastrophic dice
   * roll, a bold/disastrous decision, a striking image, an emotional turn, a
   * memorable in-character line. Short fragments, not full sentences of plot.
   * The raw material that keeps a recap lively rather than a fact list.
   */
  details?: string[];
  /** Emotional register of the beat (e.g. "tense", "triumphant", "grim", "comedic"). */
  tone?: string;
  /**
   * What three friends recapping this would ARGUE about: the contested call, the
   * dumb/bold decision, the read one host would defend and another would mock — a
   * seed for table friction so Stage 3 doesn't have to invent it. Optional so older
   * digests (which lacked it) still parse; new distills always set it.
   */
  tableAngle?: string;
  /** Characters involved (in-world names, as they appear in the transcript). */
  characters: string[];
  /** Locations involved. */
  locations: string[];
  /** Wiki terms the beat references, for Stage 3 grounding lookups. */
  wikiRefs: string[];
}

/** The distilled output for one session: ordered beats plus discarded samples. */
export interface SessionDigest {
  sessionId: string;
  /** One-or-two sentence framing of the whole session. */
  synopsis: string;
  beats: Beat[];
  /** Samples of out-of-character table talk that was filtered out (for eyeballing). */
  discarded: string[];
}

// --- Stage 3: Script --------------------------------------------------------

/** Which host is speaking. Maps to a HostPersona and a TTS voice in Stage 4. */
export type SpeakerId = "A" | "B" | "C";

/** One line of host dialogue. Speaker A/B/C map to TTS voices in Stage 4. */
export interface ScriptTurn {
  /** "A" = Recapper, "B" = Lorekeeper, "C" = Instigator (see the script system prompt). */
  speaker: SpeakerId;
  /**
   * Spoken text. May contain inline ElevenLabs v3 audio tags in square brackets
   * to direct delivery (e.g. "[warm] Hey everyone — [laughs] big week.").
   * Non-v3 backends have these tags stripped before synthesis.
   */
  text: string;
  /**
   * Legacy one-word delivery hint (e.g. "amused", "somber"). Superseded by inline
   * v3 tags in `text`; still honored as a leading tag for older scripts.
   */
  emotion?: string;
}

/** One host's identity for the script. Speaker "A"/"B" resolve to these. */
export interface HostPersona {
  name: string;
  /** One-line persona used in the (static, cacheable) system prompt. */
  persona: string;
}

export interface HostConfig {
  A: HostPersona;
  B: HostPersona;
  C: HostPersona;
}

/** A two-host podcast script for one session. */
export interface Script {
  sessionId: string;
  /** Episode title the hosts could announce. */
  title: string;
  /** The hosts this script was written for (records names/personas used). */
  hosts: HostConfig;
  turns: ScriptTurn[];
}

// --- Stage 4: TTS -----------------------------------------------------------

/** Provider-specific voice ids for the hosts (speaker A/B/C). */
export interface VoiceConfig {
  A: string;
  B: string;
  C: string;
}

/**
 * One synthesized audio clip. In "turns" mode it is a single script turn; in
 * "dialogue" mode it is a chunk of several consecutive turns rendered as one
 * natural-sounding dialogue clip (ElevenLabs Text-to-Dialogue).
 */
export interface TtsClip {
  /** 1-based clip index in playback order. */
  index: number;
  /** The (first) speaker; meaningful per-turn, informational for dialogue chunks. */
  speaker: SpeakerId;
  /** Path to the written audio file. */
  path: string;
  durationMs: number;
}

/**
 * The audio output for one session: ordered clips + metadata for Stage 5.
 * `mode` tells Stage 5 how to stitch — "turns" interleaves jittered per-turn
 * silence and fades; "dialogue" concatenates pre-paced chunks with a small,
 * uniform gap. Absent `mode` is treated as "turns" (legacy manifests).
 */
export interface AudioManifest {
  sessionId: string;
  /** How clips map to turns; defaults to "turns" when omitted. */
  mode?: "turns" | "dialogue";
  /** Audio file extension/format the clips are in, e.g. "wav" or "mp3". */
  format: string;
  voices: VoiceConfig;
  clips: TtsClip[];
}
