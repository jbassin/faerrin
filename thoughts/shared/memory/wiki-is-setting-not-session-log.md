---
name: wiki-is-setting-not-session-log
description: The wiki records the persistent STATE of the world (people/places/things/lore), NOT a log of session events; mining must extract standing facts and drop party-action narrative
metadata:
  type: feedback
---

The Faerrin wiki records **the persistent state of the setting** — the properties,
relationships, history, and lore of **people, places, organizations, objects, and concepts**.
It is **not** a log of what happened during a session (the party's actions, movements, quest
progress, encounters, scene-by-scene events).

**The test:** *Would this still be true and worth recording if I had never played this session —
is it a fact ABOUT the world, or a fact about what the party DID?* Standing world-facts persist;
session events do not belong in the wiki.

**Keep (setting facts):** "Copperjaw operates Sableclutch Scrap and has a crude copper-jaw
prosthetic"; "Hallia's tram runs along a route called the Horizon"; "Fanes are spaces sustained
by Hearts"; "Johnny is originally from Raelion, which has since been destroyed"; "Threshold
Authority police wear greenish 'TA' uniforms".

**Drop (session-event narrative):** "The party retrieved the dish from the roller rink"; "Flynn's
body was returned to the Sin and Tonic"; "The party traced the man to a train"; "The session
ended with the party approaching the child"; "The party's first mission was to investigate Flynn".

**Nuance — extract the standing fact from an event:** when an event carries a durable world-fact,
keep the fact and drop the action. "Flynn's body was recovered and returned to base" → the
keepable fact is *Flynn is dead*. "Anzu's raven Othello rejoined the party outside the Sin and
Tonic" → *Anzu has a raven companion named Othello*.

**Why:** confirmed by the worldbuilder's own review of the 2025-08-28 eval labels — he kept 80 of
142 candidates, cutting precisely the session-event/party-action entries while keeping every
people/places/things/lore fact. The old draft-labels prompt over-generated event narrative.

**How to apply:** the `mine` stage and the draft-labels prompt must instruct extraction of
**setting/state facts only**, explicitly excluding party-action/session-event narrative, and must
extract the standing fact out of an event rather than recording the event. This is a criterion
ORTHOGONAL to epistemic modality (gm-stated vs speculation, see [[heartwood-rewrite-constraints]]):
a fact can be GM-stated canon and still be a session event that does NOT belong in the wiki.

## Further refinements (worldbuilder review of fae-and-forest, 2025-09-18)

**No game mechanics for characters.** Record a character's **physical characteristics and
personality**; do **NOT** record PF2e mechanical/stat-block content — abilities, stats, spells they
can cast, weapons they wield, action economy, levels. e.g. drop "Krod wields a Nodachi with the
extend property", "Mordecai has Magnificent Mansion", "the Ugathal's blood-drain is a 3-action
manipulate". Keep "Krod can sense blood like a bloodhound" only as a *characterful trait*, not as a
mechanic. (Some borderline ability-flavor was kept in the earlier session — the bar is: flavor/trait
yes, stat-block no.)

**Use canonical proper names, not generic referents.** The fae-and-forest session is set in **the
Verdant Expanse**; the draft often wrote "the forest" or "the Sea of Trees" and the worldbuilder had
to edit them to the canonical name. Mining should prefer the **most specific proper name** the
transcript provides and resolve obvious in-chunk referents ("the forest" → the named place). In the
real pipeline this is **entity resolution (AC-20)**: surface forms and generic referents resolve to
the canonical wiki entity (using the wiki's titles/`aliases:` index). The draft-labels script has no
wiki context, so it can only do the prompt-level best-effort.

## Further refinements (worldbuilder review of interred-in-iomenei, 3rd round)

**Skip combat sections wholesale.** Combat encounters / fight scenes (initiative, attacks, damage,
tactics, who-hit-whom, monsters fought) are almost entirely mechanics + momentary events with **no
durable setting value** — do not mine them. Only if combat reveals a standing world-fact (a
creature's nature/origin) keep that single fact, never the fight. This is a high-leverage heuristic
because combat concentrates exactly the two noise classes (mechanics + events).

**Events and mechanics need AGGRESSIVE exclusion + a precision bias.** Across three review rounds the
recurring leftover noise was (1) session-event facts and (2) weapon/ability/stat facts — the prompt
must lead with these as the top mistakes and instruct "when in doubt, leave it out; precision over
volume." Mining should err toward fewer, cleaner setting facts; recall is recoverable via the human
review, but slop wastes the reviewer's time (the rejected-tool failure mode).

**Every fact must name an entity (its wiki page) — drop entity-less facts.** The wiki is organized
into pages, each owned by an entity (person/place/org/object/concept). A fact with no assigned entity
has nowhere to live, so mining drops it (and the prompt requires naming the entity, refusing facts
whose subject can't be named). Implemented in `src/pipeline/mine.ts` (drops claims with empty
`entitySurfaceForms`).

**Exclude ephemeral plot / mystery / incident details.** Distinct from session events: facts about
the *current* case the party is investigating — who committed a sabotage/crime, who had access on
the day, the whodunit specifics of the plot being solved this arc — are **ephemeral** and do NOT
belong in the wiki, even when phrased as facts. e.g. drop "Iomenei was sabotaged by an elf" and "the
workers with access on the day of the sabotage were X, Y, Z": these don't meaningfully describe the
Strider as a whole and stop mattering once the mystery resolves. **Test:** *does this durably
describe the entity AS A WHOLE and still matter after the mystery is solved?* If it's a detail of the
current situation/investigation, exclude it. (Caveat — a **permanent change to what an entity IS** is
durable and kept: "Raelion was destroyed" stays, because it changes the place's existence; an
unsolved incident detail does not.)
