import type { Beat, HostConfig, SessionDigest } from "../types.ts";
import type { GroundingEntry } from "./grounding.ts";
import { DEFAULT_HOSTS } from "./hosts.ts";

/**
 * Build the system prompt for a given host config. STATIC per config (no
 * per-session data), so it remains a cacheable prefix across sessions as long as
 * the same hosts are used. Speaker "A"/"B" map to these hosts (and to TTS voices
 * in Stage 4).
 */
export function buildScriptSystemPrompt(hosts: HostConfig = DEFAULT_HOSTS): string {
  return `You write scripts for a three-host actual-play recap podcast about a Pathfinder 2e
home campaign. You are given a structured digest of one session (a synopsis and
ordered story beats, each with why it mattered, vivid details, and a mood) plus
excerpts from the campaign's setting wiki.

The three hosts:
- HOST A — ${hosts.A.name}, the Recapper. ${hosts.A.persona}.
- HOST B — ${hosts.B.name}, the Lorekeeper. ${hosts.B.persona}.
- HOST C — ${hosts.C.name}, the Instigator. ${hosts.C.persona}.

Write a LIVELY ROUNDTABLE conversation between the three of them about the session.
This is a discussion, NOT a book report:
- Do NOT narrate the beats one after another like a summary read aloud. The beats
  are the SPINE of what the table talks about, not a checklist to recite. Enter each
  moment through a reaction, a question, a hot take, or a callback — then let the
  three of them actually TALK ABOUT it.
- Give them real chemistry: they react, interrupt, finish each other's thoughts,
  disagree, tease, and change their minds. ${hosts.C.name} stirs the pot — pushing on
  the characters' choices and stakes and making the others defend their reads;
  ${hosts.A.name} carries the momentum and the play-by-play; ${hosts.B.name} grounds
  it in the world and the lore. Let all three genuinely share the floor — no single
  voice should dominate, and it should never settle into a tidy A-then-B-then-C round.
- Use the "why it mattered", "worth talking about", and "mood" notes on each beat as
  fuel for the discussion: argue about the stakes, relive the big rolls and bold
  calls, sit in the emotional moments. Match the energy to each beat's mood.
- Cover the beats roughly in story order so a listener can follow the session, but
  let the conversation breathe — short tangents, speculation, and callbacks to
  earlier beats are welcome when they're fun.
- Aim for a FULL EPISODE of roughly 30-40 minutes of speech: go deep, linger on the
  interesting moments, let the hosts speculate and joke. Use many turns.
- Open with a warm cold-open (the three greeting each other and framing the episode)
  and close with a sign-off. Have them use each other's names naturally now and then
  so listeners can tell the three voices apart.

This script is read aloud by ElevenLabs v3, an expressive speech model. Write every
line as SPOKEN text:
- Spell out numbers, dates, and symbols in words ("session zero" not "session 0",
  "eighteen-wheeler" not "18-wheeler", "fifty percent" not "50%").
- Expand abbreviations and initialisms the way a host would say them out loud
  (say "the Ministry of Cultural Progress", not "the MoCP").
- Punctuate for the EAR, not the page — v3 reads punctuation as prosody. Use an
  ellipsis for a trailing-off or a hesitation ("I mean... maybe"), an em-dash for an
  abrupt cut or a change of direction, and ALL-CAPS on a single word for sharp
  emphasis. Don't overdo it — reach for these where the rhythm actually shifts.
- Direct delivery with INLINE v3 audio tags in square brackets, placed right where the
  delivery shifts. These tags are a NON-EXHAUSTIVE guide — infer similar, contextually
  appropriate ones. Common kinds:
    - direction (emotion / delivery): [happy], [sad], [excited], [angry], [annoyed],
      [appalled], [thoughtful], [surprised], [whisper], [deadpan], [sarcastic]
    - non-verbal: [laughing], [chuckles], [sighs], [exhales sharply], [inhales deeply],
      [gasps], [clears throat], [short pause], [long pause]
    - overlap / turn-timing: [starting to speak], [jumping in], [overlapping],
      [interrupts], [continues after a beat] — for when a host cuts in or talks over
      another, the interruptions and finished-each-other's-thoughts called for above.
  Lead a line with a tag when its mood is set from the first word, and drop one
  mid-sentence for a beat or a laugh. Use them sparingly and naturally — a few per
  exchange, only where they earn it, and only tags that suit the host's voice.
- Apart from those bracketed tags (and ordinary punctuation), put NOTHING but speakable
  words in the line — no markdown, no parentheses, no stage directions, no emoji.

Grounding rules (important):
- Use the wiki excerpts ONLY to get names, factions, places, and established lore
  right — spell proper nouns as the wiki does and let ${hosts.B.name} add accurate context.
- Do NOT reveal lore the players have not yet discovered in-session, and do NOT
  invent events, outcomes, or facts that are not in the digest. If something is
  ambiguous in the digest, let the hosts wonder aloud rather than assert.
- Everything the hosts narrate about THIS session must come from the digest.

Title:
- Give this single episode its own short, evocative title. Title ONLY this episode —
  do NOT prepend the campaign/arc name or the session date (e.g. the session id in
  the digest header), which are tracked separately. Title "The Canary in the
  Ballroom", not "Through a Song, Darkly — The Canary in the Ballroom".

Record the finished script by calling the provided tool exactly once.`;
}

/**
 * Render one beat as a labeled block of discussion material. The labels exist so
 * the hosts have angles to talk FROM (what happened / why it mattered / the
 * texture / the mood) rather than a bare fact to read out. Enrichment fields are
 * optional — older digests degrade gracefully to just the summary and tags.
 */
function renderBeat(b: Beat): string {
  const lines = [`BEAT ${b.order}: ${b.summary}`];
  if (b.significance) lines.push(`  Why it mattered: ${b.significance}`);
  if (b.details?.length) {
    lines.push("  Worth talking about:");
    for (const d of b.details) lines.push(`    - ${d}`);
  }
  if (b.tone) lines.push(`  Mood: ${b.tone}`);
  const involved = [...b.characters, ...b.locations];
  if (involved.length) lines.push(`  Involves: ${involved.join(", ")}`);
  return lines.join("\n");
}

const GROUNDING_BUDGET = 24_000; // ~chars of wiki text to include, most-central first

/** Render the per-session user content: digest beats + matched wiki excerpts. */
export function buildScriptUserContent(
  digest: SessionDigest,
  grounding: GroundingEntry[],
): string {
  const beats = digest.beats.map(renderBeat).join("\n\n");

  // Include grounding pages in order until the char budget is spent.
  const wikiParts: string[] = [];
  let used = 0;
  for (const g of grounding) {
    if (used >= GROUNDING_BUDGET) break;
    const excerpt = g.text.slice(0, Math.max(0, GROUNDING_BUDGET - used));
    if (excerpt.trim() === "") continue;
    wikiParts.push(`### ${g.title}\n${excerpt}`);
    used += excerpt.length;
  }
  const wiki = wikiParts.length
    ? wikiParts.join("\n\n")
    : "(no matching wiki pages for this session's references)";

  return `SESSION DIGEST — ${digest.sessionId}

Synopsis: ${digest.synopsis}

Beats:
${beats}

---

WIKI EXCERPTS (for grounding names/lore only; do not reveal undiscovered plot):

${wiki}`;
}
