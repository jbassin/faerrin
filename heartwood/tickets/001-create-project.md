id: 001
title: create-project
parent: none
type: epic
author: jbassin
---

We need to create a plan for turning this repository into a living wiki for a Pathfinder 2e campaign.

The `content` directory holds the existing wiki, but it's currently maintained by hand and very out of date.
The `transcripts` directory holds transcripts of the sessions in the campaign and the one-shots. We should
make a system that can read the transcripts and update the wiki with any new information discovered during
the sessions.

Transcript names are in the format `<campaign-id>.<campain-name>.<session-date>.txt`. If the campaign id < 100 it's a main campaign, and if the id >= 100 then it's from a side campaign or one-shot. Transcripts can be updated with `bun run update-transcripts` to check if any new ones are added.

We'll want to use the claude api to do the updating, but there are two major worries with using an llm-heavy
approach: cost and hallucinations.
  - Reading in the whole wiki to do edits can be expensive, and the transcripts are large.
  - The wiki is treated as a source of truth, so hallucinations **must not, under any circumstances**, make it into the wiki.

A complicating factor is that the transcripts tend to be a mix of the following, in order:
  - out of character chatter between the players at the start of the session
  - player-run recaps of one or more previous sessions
  - the in-character play, puntuated occasionally by rules info like asking for dicerolls or ooc chatter
  - possible out of character chatter at the end of the session

For cost, an approach we're considering the following (but this is subject to change if a better approach is possible):
  - build an index of the wiki with filenames, a summary, and possibly other useful metadata
  - for each transcript:
    - do an initial segmentation pass, to mark which regions are in-character and campaign-relevent.
    - do a second pass, to pick out facts from the script -- ideally as a structured list of atomic claims each tagged with the transcript line number it came from and a confidence rating.
      - e.g. something like `{ "claim": "Captain Vey revealed she serves the Iron Synod", line: 00003, confidence: "true" }`
      - note: we can usually trust what the gamemaster says to be true, but player speculation might not be.
    - match claims against the wiki index to find which page(s) it affects, and whether it's a new fact,
    an update, or a contradiction.
    - propose changes as a PR on the git repo. this project uses gitlab, so if we open a pr there I can
    review it for accuracy.
    - mark the transcript as processed, to ensure that we don't double-process any.

This is, understandably, a large project. For this ticket, we just want to scope out the work that needs to be done, and break it up into task tickets in the `tickets/` directory. We don't want to be writing any code yet.
