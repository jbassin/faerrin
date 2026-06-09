import type { Beat, HostConfig, Script, SessionDigest, SpeakerId } from "../types.ts";
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
home campaign. You are given a structured digest of one session (a synopsis and a
pool of story beats, each with why it mattered and vivid details) plus excerpts from
the campaign's setting wiki.

The three hosts:
- HOST A — ${hosts.A.name}, the Recapper. ${hosts.A.persona}.
- HOST B — ${hosts.B.name}, the Lorekeeper. ${hosts.B.persona}.
- HOST C — ${hosts.C.name}, the Instigator. ${hosts.C.persona}.

Write a LIVELY ROUNDTABLE conversation between the three of them about the session.
This is a discussion, NOT a book report:
- Do NOT narrate the beats like a summary read aloud. The beats are the SPINE the
  table follows — the through-line of the night, in the order it happened, not a
  checklist to recite. Enter each moment through a reaction, a question, a hot take,
  or a callback — then let the three of them actually TALK ABOUT it.
- Give them real chemistry: they react, interrupt, finish each other's thoughts,
  disagree, tease, and change their minds. ${hosts.C.name} stirs the pot — pushing on
  the characters' choices and stakes and making the others defend their reads;
  ${hosts.A.name} carries the momentum and the play-by-play; ${hosts.B.name} grounds
  it in the world and the lore. Let all three genuinely share the floor — no single
  voice should dominate, and it should never settle into a tidy A-then-B-then-C round.
- Use the "why it mattered", "worth talking about", and "what they'd argue about" notes
  on each beat as fuel for the discussion: argue the contested calls, relive the big
  rolls and bold moves, sit in the emotional moments. Let the feeling come through how
  they talk, not a stated mood.
- Move through the session ROUGHLY IN ORDER. The beats are given in the order they
  happened; let the conversation broadly follow that through-line so a listener can
  track the night as it unfolded. It's still a discussion, not a setlist: reach each
  moment through a reaction, a memory, or an argument rather than reciting it, glance
  back to an earlier beat when it genuinely connects, and skip or barely touch a dull
  one while lingering on a good one. Don't jump around so much the night's order gets
  lost — but don't read the list out in lockstep either.
- Aim for a FULL EPISODE of roughly 30-40 minutes of speech: go deep, linger on the
  interesting moments, let the hosts speculate and joke. Use many turns.
- Don't open with a tidy "welcome to the show" or close with a neat sign-off. Start
  mid-conversation, as if the recorder caught them already arguing about something,
  and let the end trail off rather than bow out. Have them use each other's names
  naturally now and then so listeners can tell the three voices apart.

Keep the three voices UNEQUAL. Bram is fluent but imprecise (long run-ons, wrong
details he walks back); Maeve is precise but terse (short, the exact word, the flat
correction); Pip is fast but scattered (fragments, self-interruption, dead-end
tangents). If you could swap two hosts' names on a line and it would still fit, the
line is too generic — give it back its speaker's specific texture.

AVOID THESE PODCAST TELLS — they are what makes a script feel sterile instead of like
a real table:
- Don't make every line a clean, complete quip. Most lines are just plain talk; let a
  joke BUILD across a few turns instead of firing one punchline per line.
- Don't narrate the recap's structure out loud ("first up", "moving on to", "next
  big thing", "before we wrap"). The table doesn't announce its own agenda.
- Don't fall into a tidy A-then-B-then-C rotation where each host takes one clean
  turn. Share the floor unevenly, not in a fixed rotation.
- Don't write three equally articulate voices (see above).
- Don't march the beats out in lockstep like a numbered list read aloud — follow the
  night's order loosely and in conversation, not as a mechanical recital.
- Don't resolve every disagreement — some arguments just end, unresolved, and the
  table moves on. ${hosts.C.name} doesn't have to be corrected into agreeing.
- Don't explain the inside jokes or callbacks for the listener's benefit; these
  friends don't gloss their own history.
- Don't turn the tavern into stage business — no waiter, no ordering, no fussing over
  food or drink. It's a backdrop, not a scene to play (see the setting, below).
- Don't keep a uniform energy. Vary it hard.
- Don't give anyone perfect recall.

THE SETTING: they are friends at a tavern table, not in a recording booth — that's the
WARMTH and informality of it, the reason the talk is loose and unguarded. But keep the
tavern in the BACKGROUND: no waiter or barkeep interactions, no ordering, no fussing
over food or drink, no stage business with mugs or plates. The room never intrudes on
the talk — these friends are lost in the STORY, not in their dinner. Let the place
colour the tone, but never let it pull focus from the recap.

IMPERFECTION BUDGET — real talk is mostly imperfect, so across the episode include AT
LEAST: several false starts or self-corrections ("the green one — no, the blue one");
one name or detail someone fetches wrong and gets corrected on; one disagreement that
ends unresolved; one tangent unrelated to any beat that just deflates ("...anyway");
one joke that lands flat or gets ignored; one thread that gets stepped on mid-sentence
and is NEVER finished. Concretely: end about one line in four mid-thought on an em-dash
and let the next speaker grab the floor; sometimes the dropped thought is simply lost.
The headline rule: at least a third of all lines should fail as standalone wit — a
fumble, a repair, a half-sentence, a one-word reaction, or a beat of dead air. If a
line would work as a tweet, it's too clean; rough it up or give someone something to
step on. Vary turn length hard: pair a long rolling riff against one-word reactions and
stretches of clipped back-and-forth, and use [long pause] where the table goes quiet.

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
 * Render one beat as a block of discussion material. Beats are emitted in the
 * chronological order distill produced them, and the surrounding framing asks the
 * table to follow that order loosely — but we still omit an explicit ordinal
 * ("BEAT n"), because a numbered label tips the hosts into reading the list out in
 * mechanical lockstep rather than following the night's order in conversation. The
 * labels give the hosts angles to talk FROM (what happened / why it mattered / the
 * texture / what they'd argue about) rather than a bare fact to read out. NO "Mood"
 * label either: it gets performed out loud — the beat's emotional register is
 * conveyed through the texture instead. Enrichment fields are optional — older
 * digests degrade gracefully to just the summary.
 */
function renderBeat(b: Beat): string {
  const lines = [`- ${b.summary}`];
  if (b.significance) lines.push(`  Why it mattered: ${b.significance}`);
  if (b.details?.length) {
    lines.push("  Worth talking about:");
    for (const d of b.details) lines.push(`    - ${d}`);
  }
  if (b.tableAngle) lines.push(`  What they'd argue about: ${b.tableAngle}`);
  const involved = [...b.characters, ...b.locations];
  if (involved.length) lines.push(`  Involves: ${involved.join(", ")}`);
  return lines.join("\n");
}

const GROUNDING_BUDGET = 24_000; // ~chars of wiki text to include, most-central first

/**
 * Render the per-session user content: digest beats + matched wiki excerpts, plus an
 * optional pre-formatted running-threads block (cross-session callbacks). The threads
 * block is per-session data, so it correctly lives in the user content, not the
 * cacheable system prompt.
 */
export function buildScriptUserContent(
  digest: SessionDigest,
  grounding: GroundingEntry[],
  threadsBlock: string = "",
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

  const threads = threadsBlock.trim() === "" ? "" : `\n\n---\n\n${threadsBlock.trim()}`;

  return `SESSION DIGEST — ${digest.sessionId}

Synopsis: ${digest.synopsis}

Things that happened this session, in the order they happened — walk through them
roughly in this order so the recap is easy to follow, but talk ABOUT each moment as
you reach it; don't just read the list out:
${beats}

---

WIKI EXCERPTS (for grounding names/lore only; do not reveal undiscovered plot):

${wiki}${threads}`;
}

/**
 * Pass A of two-pass generation: a free-text "raw table transcript" prompt. The
 * point is to NOT produce a polished script — emitting prose (not a forced tool
 * call) and asking for a transcript of unprepared talk keeps the model out of the
 * clean-podcast attractor that one-shot structured output falls into. Pass B
 * (dressing) turns this into structured turns without polishing it. Static per
 * host config, like the one-shot prompt.
 */
export function buildImprovSystemPrompt(hosts: HostConfig = DEFAULT_HOSTS): string {
  return `You are writing down a RAW, unedited recording of three friends —
${hosts.A.name}, ${hosts.B.name}, and ${hosts.C.name} — talking at their usual tavern
table about last night's Pathfinder 2e session. They did NOT prepare. This is a
TRANSCRIPT of what was actually said, mess and all — not a script, not a polished
recap. Your job is to capture how the talk really went.

The three friends:
- ${hosts.A.name}: ${hosts.A.persona}.
- ${hosts.B.name}: ${hosts.B.persona}.
- ${hosts.C.name}: ${hosts.C.persona}.

Format: plain text, one line per turn, as
${hosts.A.name}: what they said
${hosts.B.name}: what they said
Use the hosts' names as the speaker labels. NOTHING else — no headings, no audio tags,
no stage directions, no markdown. Ordinary spoken punctuation only: an ellipsis for
trailing off, an em-dash for a thought that gets cut off.

Real talk is mostly imperfect — write it that way:
- People interrupt and a line ends mid-thought on an em-dash; the dropped thought is
  often NEVER picked back up.
- False starts and self-corrections ("the green one — no, the blue one").
- Someone fetches a name or detail wrong and gets corrected.
- A tangent that goes nowhere and just deflates ("...anyway").
- A joke that lands flat or gets ignored; one-word reactions; people talking past each
  other; stretches of clipped back-and-forth and the odd beat of dead air.
At least a third of the lines should fail as standalone wit. If a line reads like a
polished podcast quip, it's wrong — rough it up. Keep the three voices UNEQUAL:
${hosts.A.name} fluent but imprecise, ${hosts.B.name} precise but terse,
${hosts.C.name} fast but scattered. If you could swap two names on a line and it would
still fit, it's too generic.

They are friends at a tavern table, not in a booth — that's the warm, informal feel of
it. Keep the tavern in the background, though: no waiter or barkeep, no ordering, no
fussing over food or drink. The room never pulls focus — they're lost in the story, not
their dinner.

Walk through the session below ROUGHLY IN THE ORDER IT HAPPENED — the moments are
listed in sequence, and the talk should broadly follow that through-line so it's easy
to follow. You don't have to cover all of it: skip the dull bits, sit on a good one,
and glance back to an earlier moment when it connects — just don't jump around so much
the night's order gets lost. Reach each moment through memory or an argument, not a
flat recital. Don't announce an agenda, don't open with "welcome to the show", don't
sign off cleanly: start mid-conversation and let it trail off. Aim for a long session,
roughly 30-40 minutes of talk.

Grounding: use the wiki excerpts ONLY to spell names, factions, places, and lore right
(${hosts.B.name} is the one who'd know them). Do NOT invent events or outcomes not in
the digest, and do NOT reveal lore the players haven't discovered in-session.

Write the transcript now, and nothing else.`;
}

/**
 * Pass B of two-pass generation: the "protective dressing" prompt. It takes Pass A's
 * raw transcript and records it as structured turns via the record_script tool,
 * adding inline v3 audio tags and TTS-safe spelling — but is FORBIDDEN to improve the
 * dialogue. The whole value of two-pass is lost if this pass polishes the mess, so the
 * prohibitions are emphatic. Static per host config.
 */
export function buildDressingSystemPrompt(hosts: HostConfig = DEFAULT_HOSTS): string {
  return `You are a careful transcript FORMATTER, not a writer. You are given a raw
transcript of three friends (${hosts.A.name}, ${hosts.B.name}, ${hosts.C.name}) talking
at a tavern table. Your only job is to record it as structured turns by calling the
provided tool exactly once: split it into turns, map each speaker, add inline delivery
direction, and make it speakable. You are a typesetter.

Map the speaker labels to ids: ${hosts.A.name} → A, ${hosts.B.name} → B,
${hosts.C.name} → C.

DO NOT improve the dialogue. This is the most important rule:
- Do NOT make any line wittier, more complete, more articulate, smoother, or more
  polished. Preserve every fumble, false start, self-correction, repetition,
  interruption, trailing-off, one-word reaction, and dropped/unfinished thread EXACTLY
  as written. If a line is awkward or unfinished, keep it awkward and unfinished.
- Do NOT add, remove, merge, reorder, or "clean up" content. Same words, same order,
  same mess. Do NOT resolve anything the transcript left unresolved.

What you MAY do (formatting only):
- Split the raw text into one turn per speaker utterance, in order.
- Add inline ElevenLabs v3 audio tags in square brackets where the delivery the words
  already imply shifts — direction ([happy], [excited], [annoyed], [thoughtful],
  [deadpan], [sarcastic]), non-verbal ([laughing], [chuckles], [sighs], [exhales
  sharply], [clears throat], [short pause], [long pause]), and overlap/turn-timing
  ([jumping in], [overlapping], [interrupts]). Use them sparingly, only where earned,
  and only tags that suit the speaker. Infer similar ones as needed.
- Make text speakable for ElevenLabs v3: spell out numbers, dates, symbols, and
  abbreviations in words; keep the ellipses, em-dashes, and single-word CAPS that carry
  prosody. Everything outside the [tags] must be plain speakable words — no markdown, no
  parentheses, no stage directions, no emoji.
- Give the episode its own short, evocative title (this episode only — no campaign or
  arc name, no date).

Call the tool exactly once with the full formatted script.`;
}

/** Wrap Pass A's raw transcript as the user content for the Pass B dressing call. */
export function buildDressingUserContent(transcript: string): string {
  return `RAW TRANSCRIPT (format this as-is; do not improve it):\n\n${transcript}`;
}

/**
 * Voice-sharpening pass (Phase 5): a focused per-host rewrite. One pass per host,
 * each pushing exactly that host's lines further into their archetype while copying
 * every other turn verbatim — done one host at a time so the model can't re-average
 * the three voices toward a shared mean (the regression a single pass produces).
 * Static per (host config, target).
 */
export function buildSharpenSystemPrompt(
  hosts: HostConfig,
  target: SpeakerId,
): string {
  const host = hosts[target];
  return `You are doing a FOCUSED VOICE PASS on a finished episode script. Sharpen
exactly ONE host's voice — ${host.name} (speaker "${target}") — and change NOTHING else.

${host.name}'s voice, pushed further toward the extreme: ${host.persona}.

Rules:
- Rewrite ONLY ${host.name}'s lines. Push their phrasing and delivery further into the
  voice above — more distinctly themselves, LESS like the other two. If one of their
  lines reads like it could belong to another host, that's the one to fix.
- Keep the same CONTENT and intent in each of ${host.name}'s lines: say the same thing,
  just more in their voice. Do NOT add new claims, jokes, facts, or callbacks; do NOT
  resolve anything that was left open.
- Copy every OTHER host's turn EXACTLY as given — same words, same speaker, same order.
  Do not touch them.
- Keep the EXACT same number of turns, in the same order, with the same speakers. Do
  not add, remove, merge, or reorder turns. Keep the title unchanged.
- Keep it spoken text for ElevenLabs v3: inline [audio tags] where delivery shifts,
  numbers and symbols spelled out, ellipses/em-dashes/CAPS for prosody, and nothing but
  speakable words outside the tags.

Record the FULL script — every turn, in order — by calling the tool exactly once.`;
}

/** Render the current script as the input for a voice-sharpening pass. */
export function buildSharpenUserContent(script: Script): string {
  const body = script.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
  return `EPISODE TITLE: ${script.title}\n\nSCRIPT:\n${body}`;
}
