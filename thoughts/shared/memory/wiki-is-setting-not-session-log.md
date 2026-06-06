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
