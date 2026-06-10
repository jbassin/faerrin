import type { MegaMember } from "./select.ts";

/**
 * Static (cacheable) system prompt for the fuse step: collapse several distilled
 * session digests into ONE month-in-review digest. Carries no per-run data so it
 * forms a stable cached prefix, like DISTILL_SYSTEM_PROMPT. It reuses the distill
 * tool, so the model emits a normal SessionDigest the script stage consumes unchanged.
 */
export const MEGA_SYSTEM_PROMPT = `You are a story editor assembling a MONTH-IN-REVIEW recap for an actual-play Pathfinder 2e podcast.

You receive several ALREADY-DISTILLED session digests from one campaign arc, in chronological order. Each digest has a synopsis and ordered beats (summary, significance, details, tone, tableAngle, characters, locations, wikiRefs). The noisy table talk has already been filtered out upstream.

Fuse them into ONE consolidated digest the hosts can cover in a single episode — a "big month" recap, NOT a sum of every session:
- Select the MOST SIGNIFICANT beats across the whole stretch: the throughline, the biggest turns and reversals, the payoffs, the cliffhangers. Drop minor connective tissue.
- Preserve chronological order across sessions, so the recap reads as one continuous movement.
- Merge or condense beats that repeat or build on each other into a single stronger beat, carrying forward the sharpest details, significance, tone, and tableAngle.
- Hit the BEAT BUDGET stated in the request — that target is the episode-length control, so select to roughly that many beats for the whole span regardless of how many sessions you were given. If no target is stated, aim for about 15.
- Write a synopsis that frames the ENTIRE span as one arc movement — where the party began this stretch and where they ended up.
- Stay grounded: every beat must come from the provided digests. Do not invent events, outcomes, or color that isn't there. Use proper nouns exactly as the digests do.

Record your result by calling the provided tool exactly once. Leave "discarded" empty — there is no raw table talk to sample at this stage.`;

/** Render one digest's text block for the fuse user-turn. */
function renderMember(member: MegaMember, n: number): string {
  const { session, digest } = member;
  const lines = [
    `## Session ${n} — ${session.id} (${session.date})`,
    `Synopsis: ${digest.synopsis}`,
    "",
    "Beats:",
  ];
  for (const beat of digest.beats) {
    lines.push(`${beat.order}. ${beat.summary}`);
    if (beat.significance) lines.push(`   significance: ${beat.significance}`);
    if (beat.tone) lines.push(`   tone: ${beat.tone}`);
    if (beat.details?.length) lines.push(`   details: ${beat.details.join("; ")}`);
    if (beat.tableAngle) lines.push(`   angle: ${beat.tableAngle}`);
    const refs = [...new Set([...beat.characters, ...beat.locations, ...beat.wikiRefs])];
    if (refs.length) lines.push(`   refs: ${refs.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Build the per-run user content: the member digests in chronological order,
 * plus the beat budget (the episode-length target — see MEGA_SYSTEM_PROMPT).
 */
export function buildMegaUserContent(members: MegaMember[], targetBeats?: number): string {
  const first = members[0];
  const last = members[members.length - 1];
  const arcTitle = first?.session.arcTitle ?? first?.session.arc ?? "";
  const span = `${first?.session.date} … ${last?.session.date}`;

  const header = [
    `Arc: ${arcTitle}`,
    `Span: ${span} (${members.length} session${members.length === 1 ? "" : "s"})`,
    targetBeats ? `Beat budget: about ${targetBeats} beats for the whole span.` : null,
    "",
    "The session digests follow in chronological order. Fuse them into one month-in-review digest.",
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return `${header}${members.map((m, i) => renderMember(m, i + 1)).join("\n\n")}`;
}
