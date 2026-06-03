// ElevenLabs v3 "audio tags" are bracketed delivery cues placed inline in the
// text, e.g. "[warm] Hey everyone. [laughs] Big week." Only v3 interprets them;
// every other backend would read the brackets aloud, so non-v3 paths strip them.

/** Inline v3 audio tag, e.g. "[laughs]" or "[French accent]". */
const TAG = /\[[^\][]*\]/g;

/**
 * Remove inline v3 audio tags and tidy the whitespace they leave behind, so a
 * non-v3 backend speaks clean prose. "[warm] Hey — [laughs] big week." becomes
 * "Hey — big week."
 */
export function stripAudioTags(text: string): string {
  return text
    .replace(TAG, " ")
    .replace(/\s+([,.!?;:])/g, "$1") // don't strand punctuation after a removed tag
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The text to actually send to a backend for one turn. v3 keeps inline tags and
 * gets a legacy `emotion` promoted to a leading tag; everything else is stripped
 * to clean prose.
 */
export function renderDelivery(text: string, emotion: string | undefined, v3: boolean): string {
  if (!v3) return stripAudioTags(text);
  return emotion ? `[${emotion}] ${text}` : text;
}
