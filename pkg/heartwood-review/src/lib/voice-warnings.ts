// The automatable subset of the spec's §9 "good prose" bar (AC-9, AC-17). These are
// **warnings only** — they direct the reviewer's eye and feed a slop-rate metric; they
// NEVER auto-reject (the human is always the gate). The subjective items in §9
// (perspective, tension, idiom) are reviewer judgment, not encoded here.
//
// Pure + deterministic so it's unit-tested and runs client-side as the reviewer types.

export type VoiceWarningType =
  | "encyclopedia-opener"
  | "it-is-template"
  | "intensifier"
  | "empty";

export interface VoiceWarning {
  type: VoiceWarningType;
  message: string;
}

// "{Name} is a/an/the {type}…" — the slop opener §9 calls out ("X is a large
// scrapyard located within the neighborhood").
const OPENER_RE =
  /^\s*(?:\[\[)?[A-Z][\w'’ -]*?(?:\]\])?\s+is\s+(?:a|an|the)\s+\w+/;

// Filler intensifiers used as meaningless volume (§9 list).
const INTENSIFIERS = [
  "large",
  "vast",
  "expansive",
  "numerous",
  "various",
  "many",
  "massive",
  "huge",
  "enormous",
];

/** Split into naive sentences (good enough for warnings; not the anchor splitter). */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Run the automatable §9 checks over a block of (human-authored) wiki prose.
 * Returns zero or more non-blocking warnings.
 */
export function voiceWarnings(text: string): VoiceWarning[] {
  const out: VoiceWarning[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    out.push({ type: "empty", message: "No prose written yet." });
    return out;
  }

  const sents = sentences(trimmed);
  const first = sents[0] ?? "";
  if (OPENER_RE.test(first)) {
    out.push({
      type: "encyclopedia-opener",
      message:
        'Encyclopedia opener ("X is a/the …"). The wiki voice avoids the dictionary-entry cadence — lead with a point of view or tension.',
    });
  }

  // "It is …" as the second sentence — the slop archetype's template cadence.
  const second = sents[1] ?? "";
  if (/^it\s+is\b/i.test(second)) {
    out.push({
      type: "it-is-template",
      message: '"It is …" follow-on reads as templated. Vary the cadence.',
    });
  }

  const words = trimmed.split(/\s+/);
  const intensifierHits = words.filter((w) =>
    INTENSIFIERS.includes(w.toLowerCase().replace(/[^a-z]/g, "")),
  );
  if (intensifierHits.length > 0) {
    out.push({
      type: "intensifier",
      message: `Filler intensifier${intensifierHits.length > 1 ? "s" : ""}: ${[...new Set(intensifierHits.map((w) => w.toLowerCase().replace(/[^a-z]/g, "")))].join(", ")}. Prefer specific, consequence-bearing detail.`,
    });
  }

  return out;
}
