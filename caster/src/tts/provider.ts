/** One synthesis request: speakable text + the voice to use + optional delivery. */
export interface SynthesisRequest {
  /** The text to speak. */
  text: string;
  /** Provider-specific voice id. */
  voice: string;
  /** Optional delivery hint; providers that support styles may use it. */
  emotion?: string;
}

/** Result of synthesizing one request. */
export interface SynthesisResult {
  audio: Uint8Array;
  durationMs: number;
}

/** One speaker's line within a multi-turn dialogue request. */
export interface DialogueInput {
  /** Speakable text, already including any inline v3 audio tags. */
  text: string;
  /** Provider-specific voice id for this line. */
  voice: string;
}

/** A run of consecutive turns to synthesize as one natural dialogue clip. */
export interface DialogueRequest {
  inputs: DialogueInput[];
}

/**
 * A text-to-speech backend. Implementations turn one request into audio bytes.
 * `format` is the file extension the bytes are in (e.g. "wav", "mp3"); the
 * orchestrator uses it to name clip files. Kept minimal so it's trivially
 * mockable in tests and swappable for a real provider later.
 *
 * A provider that sets `dialogue = true` and implements `synthesizeDialogue`
 * can render several turns at once with natural turn-taking (ElevenLabs v3
 * Text-to-Dialogue); the orchestrator prefers that path when available.
 */
export interface TTSProvider {
  readonly format: string;
  /** True if this backend can synthesize multi-turn dialogue in one call. */
  readonly dialogue?: boolean;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  /** Render a run of turns as one dialogue clip. Required when `dialogue` is true. */
  synthesizeDialogue?(req: DialogueRequest): Promise<SynthesisResult>;
}
