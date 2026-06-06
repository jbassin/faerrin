# Heartwood eval set (Phase 0b · D-12 · AC-19)

The eval set is how we measure the pipeline with **numbers, not vibes** — coverage (recall)
and false-canon rate — so every later change to mining/triage/resolution is judged against a
fixed target. The old pipeline captured ~52% of a session; that's the baseline to beat.

## What you (the worldbuilder) do

Hand-label **the sessions in `labels/`** — ideally **~2 sessions across ≥2 arcs** (templates are
provided for `through-a-song-darkly@2025-08-28` and `fae-and-forest@2025-09-18`; change these if
you'd rather label others). For each session, read the transcript at
`../../content/transcripts/<file>.txt` and write down the **canon facts that the wiki should
capture** — the in-world truths a good editor would fold into the wiki after that session.

For each fact, fill one entry in `canonFacts`:

```jsonc
{
  "id": "rh-warehouses",                         // any stable short id, unique in the file
  "statement": "The Roundhat Gang controls the Fousan warehouses.",  // the canon fact, plainly
  "entities": ["Roundhat Gang", "Fousan"],        // the entities it concerns (names/aliases)
  "citations": [{ "start": 1180, "end": 1184 }]   // optional: transcript line span(s)
}
```

Guidance:
- **Only canon** — what the GM established as world-fact. Skip out-of-character banter, jokes,
  rules lookups, and player speculation (those test the tool's *triage*, not its recall).
- **One fact per entry**, atomic. "Pell is a ferryman who owes Argyle a debt" is two facts.
- **Be reasonably complete** — this is the recall target, so include the facts you'd be annoyed
  the tool missed. 15–40 per session is typical.
- `goodSentences` / `badSentences` are optional voice exemplars (good = reads like your wiki;
  bad = AI-slop) used later for slop calibration.

## What happens next

Once these are filled, the pipeline (mine → triage → resolve) runs on the same sessions and the
eval scorer (`src/eval/score.ts`) reports coverage + false-canon against your labels. The
Phase 1 LLM stages are then tuned to beat the baseline before the review app is built.

The label schema is enforced by `src/eval/labels.ts` (`EvalLabelSchema`) — malformed files fail
loudly.
