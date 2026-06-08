import type { Beat, SessionDigest } from "../types.ts";

/** Thrown when the model's tool input doesn't match the expected digest shape. */
export class DigestParseError extends Error {
  override name = "DigestParseError";
}

function asStringArray(value: unknown, ctx: string): string[] {
  if (!Array.isArray(value)) throw new DigestParseError(`${ctx} must be an array`);
  return value.map((v, i) => {
    if (typeof v !== "string") throw new DigestParseError(`${ctx}[${i}] must be a string`);
    return v;
  });
}

function parseBeat(value: unknown, i: number): Beat {
  if (typeof value !== "object" || value === null) {
    throw new DigestParseError(`beats[${i}] must be an object`);
  }
  const b = value as Record<string, unknown>;
  if (typeof b.order !== "number" || !Number.isFinite(b.order)) {
    throw new DigestParseError(`beats[${i}].order must be a number`);
  }
  if (typeof b.summary !== "string" || b.summary.trim() === "") {
    throw new DigestParseError(`beats[${i}].summary must be a non-empty string`);
  }
  const beat: Beat = {
    order: b.order,
    summary: b.summary,
    characters: asStringArray(b.characters ?? [], `beats[${i}].characters`),
    locations: asStringArray(b.locations ?? [], `beats[${i}].locations`),
    wikiRefs: asStringArray(b.wikiRefs ?? [], `beats[${i}].wikiRefs`),
  };
  // Enrichment fields are optional so digests distilled before they existed still
  // parse; we only attach them when the model actually provided usable values.
  if (typeof b.significance === "string" && b.significance.trim() !== "") {
    beat.significance = b.significance;
  }
  if (b.details !== undefined) {
    const details = asStringArray(b.details, `beats[${i}].details`).filter((d) => d.trim() !== "");
    if (details.length) beat.details = details;
  }
  if (typeof b.tone === "string" && b.tone.trim() !== "") {
    beat.tone = b.tone;
  }
  if (typeof b.tableAngle === "string" && b.tableAngle.trim() !== "") {
    beat.tableAngle = b.tableAngle;
  }
  return beat;
}

/**
 * Validate the model's tool input into a SessionDigest, attaching the sessionId
 * ourselves. Beats are renumbered to a contiguous 1-based order sorted by the
 * model's `order`, so downstream code can rely on it regardless of model quirks.
 */
export function parseDigest(sessionId: string, raw: unknown): SessionDigest {
  if (typeof raw !== "object" || raw === null) {
    throw new DigestParseError("tool input must be an object");
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.synopsis !== "string") {
    throw new DigestParseError("synopsis must be a string");
  }
  if (!Array.isArray(r.beats) || r.beats.length === 0) {
    throw new DigestParseError("beats must be a non-empty array");
  }

  const beats = r.beats
    .map((b, i) => parseBeat(b, i))
    .sort((a, b) => a.order - b.order)
    .map((beat, idx) => ({ ...beat, order: idx + 1 }));

  return {
    sessionId,
    synopsis: r.synopsis,
    beats,
    discarded: asStringArray(r.discarded ?? [], "discarded"),
  };
}
