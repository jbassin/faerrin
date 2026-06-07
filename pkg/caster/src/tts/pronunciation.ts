/**
 * In-repo pronunciation lexicon for invented proper nouns (Faerrin/Pathfinder
 * names) that TTS otherwise mangles. Maps a term to its IPA; the IPA is injected
 * inline as `/…/`, which ElevenLabs v3 honors. Data lives in the repo
 * (content/pronunciations.json) — no account-side dictionary, no dashboard.
 */
export type Lexicon = Record<string, string>;

/**
 * Load the term→IPA lexicon from a JSON file. A missing or unparseable file is a
 * no-op (returns an empty lexicon) so the pipeline runs fine without one.
 */
export async function loadLexicon(path: string): Promise<Lexicon> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return {};
    const data = (await file.json()) as unknown;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
    const lexicon: Lexicon = {};
    for (const [term, ipa] of Object.entries(data as Record<string, unknown>)) {
      if (typeof ipa === "string" && term.trim() !== "" && ipa.trim() !== "") lexicon[term] = ipa;
    }
    return lexicon;
  } catch {
    return {};
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap known terms in inline IPA (`/ipa/`) for v3 delivery. Each term is replaced
 * at most once (first occurrence, whole-word), and replacements never reach text
 * inside existing `[audio tags]`. Returns the text unchanged when the lexicon is
 * empty or no term matches.
 *
 * Only meaningful on the v3 path — callers must not run this for non-v3 voices,
 * which would read the slashes aloud.
 */
export function applyPronunciations(text: string, lexicon: Lexicon): string {
  const terms = Object.keys(lexicon);
  if (terms.length === 0) return text;

  // Split on [..] tag spans so we only rewrite spoken prose. With a capturing
  // group, tag spans land on odd indices and are left untouched.
  const parts = text.split(/(\[[^\]]*\])/);
  const applied = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue; // a [tag] span
    let segment = parts[i]!;
    for (const term of terms) {
      if (applied.has(term)) continue;
      const re = new RegExp(`\\b${escapeRegExp(term)}\\b`);
      if (re.test(segment)) {
        segment = segment.replace(re, `/${lexicon[term]}/`);
        applied.add(term);
      }
    }
    parts[i] = segment;
  }
  return parts.join("");
}
