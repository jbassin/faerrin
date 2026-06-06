---
title: Heartwood Rewrite — Natural-Language Specification
status: ratified (v1.0, pre-implementation — all open questions resolved)
date: 2026-06-06
authors: team-mode spec effort (Claude personas: backend-architect, product-writer, adversarial reviewer, synthesis)
supersedes: the existing 7-stage heartwood pipeline (segment→extract→resolve→match→propose→submit→respond)
related:
  - thoughts/shared/memory/heartwood-rewrite-constraints.md
  - thoughts/shared/memory/transcript-arcs-and-naming.md
  - thoughts/shared/memory/wiki-nonprose-pages.md
  - pkg/heartwood/CLAUDE.md (old system of record)
---

> **v1.0 note.** v0.2 incorporated an adversarial completeness pass (grounded in the real
> corpus) that corrected three load-bearing assumptions and added missing requirements:
> (1) the corpus is **6+ concurrent campaign arcs**, not one linear session stream, so
> identity (§5, §7) is arc-aware; (2) **entity identity / alias resolution** is a first-class
> subsystem (§6.2, AC-20); (3) the voice bar is **page-type-aware** (§9); (4) **narrative
> coherence** (AC-23), **correction/retraction of committed canon** (AC-21), and provenance
> storage are explicit. **v1.0 then resolved all 12 open questions** with stakeholder
> decisions — recorded in §13, with the consequential ones propagated into §§6–11. The spec
> is now ready to drive an implementation plan.

# Heartwood Rewrite — Specification

## 0. How to read this document

This is a **natural-language specification (NLSpec)**: it defines *what the rewritten
heartwood must do* and *why*, not *how to code it*. It is the contract a subsequent
implementation plan (`/octo:plan` or `create-plan`) builds against. Where it makes a
design choice, it says so and records the alternatives. Acceptance criteria (§11) are the
testable surface; everything above them is the rationale that makes the criteria make sense.

---

## 1. Problem statement

Heartwood turns Pathfinder 2e session transcripts into edits on a hand-maintained Obsidian
worldbuilding wiki (rendered by the **aether** site, `heart.iridi.cc`). The existing
implementation was rejected wholesale by stakeholders. The rewrite starts from first
principles.

**Why the current system failed** (all four stakeholder-confirmed):

1. **Edit quality / accuracy.** It emitted hallucinated, wrong, or low-value "facts," and
   treated speculative player guesses (`confidence: "speculative"`) as canon. Worse, its
   prose was flat encyclopedic AI-slop injected into pages with a strong human voice.
2. **Review burden.** One session produced ~112 claims → 38 clusters → ~37 separate
   proposals shipped as a single GitHub PR with many inline discussion threads. The
   reviewer could not see the session as a coherent narrative; reviewing cost more than
   hand-editing would have.
3. **Wrong surface.** GitHub PRs with `+`/`-` diff hunks and comment threads are the wrong
   review surface for worldbuilding prose. You judge prose by *reading it rendered*, not by
   reading a diff.
4. **Coverage.** It captured only ~52% of a transcript, and captured the wrong things.

**Two hard truths about the data** (confirmed by sampling real artifacts):

- **The source is ~50% noise.** Transcripts are raw Craig/Discord recordings: a sampled
  25-line span was entirely out-of-character banter (mortgage rates, Chinese property law)
  ending in "let's play Pathfinder"; another session opens with 40 lines of USB-adapter and
  dead-bird jokes. Only intermittently is there in-world canon. The tool's first job is
  *triage*, and coverage is fundamentally a **recall** problem.
- **The target has a real literary voice.** Hand-written pages read like prose, not data —
  e.g. Sableclutch is "dominated by the **dockworkers and warehouse employees that ply their
  trade on the river**… **somewhat overlooked by the rest of the capital**." The voice is
  terse, perspectival, consequence-aware, idiomatic, and wikilink-woven. The old tool's
  output ("X is a large scrapyard located within the neighborhood. It is an expansive site
  featuring mountains of trash.") is the antithesis. **Voice may be partially unlearnable by
  an LLM** — the design must not depend on the model writing publishable prose unaided.

## 2. Vision (one paragraph)

After each session, the worldbuilder opens a purpose-built **interactive review app**. The
tool has already separated canon from banter, mined the in-world facts (each cited back to
exact transcript lines), and grouped them into per-page proposals. The reviewer reads each
proposed change **rendered in place** on the page it touches — not as a diff — confirms it
against the cited transcript lines on hover, edits the prose in his own voice where needed,
and approves. Approved changes are written to the wiki working tree as a single batched
commit (via **jj**), with machine-readable provenance recorded underneath the human-facing
prose. No GitHub PR. No hallucination reaches the wiki without his explicit, per-proposal
click.

## 3. Goals & non-goals

### Goals
- **G1.** Reliably separate in-world canon from out-of-character noise, with the human able
  to correct the split cheaply.
- **G2.** Extract atomic, transcript-cited facts; never present a player's speculation as
  established canon.
- **G3.** Produce wiki prose that reads as genuine human-authored worldbuilding — the
  rendered result is judged as literature, not a data dump (the **north-star constraint**).
- **G4.** Replace the PR surface with an interactive review UI that shows changes as rendered
  prose in context, with one-hover provenance and frictionless edit-in-place.
- **G5.** Record machine-readable provenance (which wiki sentences came from which session
  and which transcript lines) without polluting the reader-facing prose.
- **G6.** Detect and surface cross-session **canon conflicts / retcons** for explicit human
  resolution rather than silently appending contradictions.
- **G7.** Keep LLM cost bounded (never shovel the whole wiki/transcript into one call) and
  make runs incremental and idempotent as sessions accumulate.
- **G8.** Be measurable: a hand-labeled evaluation set so "coverage" and "slop rate" are
  numbers, not vibes.

### Non-goals
- **N1.** No GitHub PRs, inline comment threads, or CI merge gate (the rejected surface).
- **N2.** No multi-reviewer / approval-chain workflow. One trusted reviewer; his click is the
  only gate.
- **N3.** No autonomous/unattended commits — every change is human-approved per proposal,
  even "obvious" facts.
- **N4.** No transcript correction here (ASR/speaker fixes belong to content's existing
  review tooling).
- **N5.** No editing of `Script/` pages (aether-generated transcript pages, not wiki
  articles — excluded, as today).
- **N6.** Not a general-purpose wiki editor; freeform authoring stays in Obsidian. Heartwood
  edits *in response to a session*.
- **N7.** No real-time / in-session live capture; operates on completed transcripts.

## 4. Actors

| Actor | Description | Relationship to the tool |
|---|---|---|
| **Worldbuilder / GM** | Runs the campaign, hand-wrote the entire wiki, *owns the voice*. Sole reviewer, fully trusted. Not necessarily a developer. | The only human actor. Every approval is his. He is the source of the voice the tool imitates and the final gate. |
| **Ingestion/mining pipeline** | Headless, LLM-backed. Runs ahead of review. | Produces cited claims + proposals; never writes to the wiki. |
| **Review app** | Local-first web app, near/in aether. | The product surface; where all human decisions happen. |
| **The wiki (`pkg/content/wiki/`)** | SSOT worldbuilding corpus; aether is canonical renderer. | Target of approved changes; source of "what's already known" and the voice. |
| **Transcripts (`pkg/content/transcripts/`)** | SSOT, line-numbered, speaker-labelled. | Source of truth for claims; the citation primitive (line IDs). |

## 5. Domain glossary

- **Arc** — a distinct campaign storyline, identified by the transcript filename's numeric
  prefix (`000 through-a-song-darkly`, `101 interred-in-iomenei`, `102 fae-and-forest`,
  `103 a-hunt-of-metal-and-vine`, `104 the-first-spark`, `105 observatory-slipped`,
  `106 fey-in-the-mists`, …). As of 2026-06-06 the corpus is **41 transcripts across 6+
  arcs** — they may be parallel parties and/or different world-times. **Arcs are a first-class
  dimension**: canon, conflict detection, and any timeline must be reasoned about per-arc and
  at the world level, not as one linear stream.
- **Session** — one transcript = one recording of one arc. Its identity is **`(arc, date)`**,
  **not** the filename stem: the `000` arc alone has ~30 transcripts that share the identical
  basename `000.through-a-song-darkly` and differ only by the date. Filename dates are
  **recording** dates, not in-world dates.
- **Line citation** — a reference into a transcript. Line IDs are zero-padded 6-digit and
  **per-file**, so a citation is unique only as **`(transcript, lineId)`**, never `lineId`
  alone. This tuple is the atomic provenance primitive.
- **Entity** — a world noun (person, place, org, deity, phenomenon, rule). The same entity may
  appear under multiple surface forms across sessions (ASR variance, nicknames, partial
  names). An entity has a **canonical identity** that maps to at most one wiki page (or a
  pending new-page proposal) and a set of **aliases** (the wiki already encodes these in the
  `aliases:` frontmatter field — the tool must use and extend it).
- **Claim** — an atomic in-world fact mined from a session, each carrying **line citations**
  (`(transcript, lineId)` ranges), a **speaker/role**, an **epistemic modality** (see below),
  and resolved **entity** references. A claim must be a **setting fact** (next entry).
- **Setting fact vs. session event** — the wiki records the **persistent state of the world**
  (properties, relationships, history, and lore of people, places, organizations, objects, and
  concepts), **not a log of what the party did this session** (movements, quest/mission
  progress, encounters, scene-by-scene events). The test: *would this still be true and worth
  recording if the session had never been played?* Mining keeps standing world-facts and drops
  party-action narrative — and when an event reveals a durable fact, it **extracts the fact, not
  the action** (e.g. "the body was returned to base" → record *the NPC is dead*). This is a
  criterion **orthogonal to modality**: a fact can be GM-stated canon and still be a session
  event that does not belong in the wiki. Two further bars from worldbuilder review:
  **(a) no game mechanics** — record a character's physical characteristics and personality, but
  **not** PF2e stat-block content (abilities, stats, spells, weapons, action economy, levels);
  **(b) canonical names** — prefer the specific proper name over generic referents ("the forest"
  → the Verdant Expanse), resolving referents to named entities (this is `Resolve`'s job, AC-20).
  See `wiki-is-setting-not-session-log` memory.
- **Sentence anchor** — a durable handle identifying *which* wiki sentence a provenance record
  attaches to, robust to surrounding edits (not a raw character offset, which breaks on the
  next manual edit). Storage layer decided (D-1: render-invisible sidecar); the exact anchor
  representation is the one Phase 0a design detail.
- **Modality** — the epistemic status of a claim: `gm-stated` (canon), `player-speculation`,
  `in-character-fiction`, `uncertain`, `noise`. Replaces the old binary
  stated/speculative and is load-bearing for "don't treat guesses as canon."
- **Proposal** — one coherent unit of proposed wiki change (create a page, amend a page, or
  **correct/retract** a previously-committed fact), backed by one or more claims. The unit of
  review. A single real-world **event** may legitimately touch several pages; such a
  multi-page proposal is grouped and reviewed together (AC-22).
- **Canon Ledger** — the persisted, structured record of accepted facts with provenance;
  the machine-readable layer that sits *underneath* the human prose.
- **Provenance** — the link from a wiki sentence → the session + transcript line IDs that
  justify it.

## 6. The model (rethought)

Three architectures were evaluated (full analysis in the team thread; summarized in §15).
The chosen model is **"Canon Ledger + Assisted Authoring"** (architecture A), augmented with
two elements borrowed from the more ambitious "Two-Layer Canon Graph" (architecture C):
**modality tags** and a **cross-session conflict flag**. Architecture C's full
structured-graph-as-SSOT (with prose as a generated projection) and its associated aether
renderer inversion are **deferred** — they are the natural v2 if the ledger proves out.

**The load-bearing principle:** *draw the automation line exactly where LLMs are reliable,
and keep the human on the pen where they are not.* LLMs are good at the mechanical work —
discarding banter, isolating atomic facts, citing lines, finding the right page, detecting
contradictions. LLMs are unreliable at the literary voice. So the tool **structures and
cites; the human authors.** This fixes the four rejections by construction:

- Edit quality → the human writes/edits the final prose; the tool never silently commits
  generated sentences.
- Review burden → review is per-page, rendered, narrative — not 37 micro-diffs.
- Wrong surface → an interactive app, not PRs.
- Coverage → triage + a recall-focused eval set make misses visible and tunable.

### 6.1 Data flow

```
transcript (line-numbered, ~50% noise)
   │
   ▼  [ingest]   split into utterances; attach speaker/role; cheap noise pre-filter
   ▼  [mine]     LLM extracts atomic CLAIMS, each: text + (transcript,lineId) + speaker + MODALITY
   ▼  [triage]   sort claims → Canon / Uncertain / Noise (human confirms, subtractively)
   ▼  [resolve]  map claim surface forms → canonical ENTITY + page (uses aliases index)
   ▼  [locate]   match each canon claim to an existing page OR flag "new page"
   ▼  [conflict] detect contradictions vs. existing wiki + prior approved claims (arc-aware)
   ▼  [draft]    assemble per-page PROPOSALS + a per-session NARRATIVE summary; optionally a
   │             voice-conditioned DRAFT sentence (labelled draft, never auto-committed)
   ▼  ┌─────────────────── REVIEW APP (the product) ───────────────────┐
      │ session narrative overview → triage → read rendered-in-context │
      │ → verify via cited lines → edit-in-place / approve / reject /  │
      │ defer → resolve conflicts & entity merges                      │
      └───────────────────────────────────────────────────────────────┘
   ▼  [commit]   write approved prose + provenance to wiki working tree; one jj commit/session
```

> **On the "draft" step (D-5, ratified):** Phase 2 ships **human-authored** prose — the tool
> structures and cites; the human writes the sentence, assisted by the §9 *warnings* (never
> auto-accept). The optional in-voice **draft + warn-only "voice critic"** is **deferred to
> Phase 4**: when added, it offers a generated sentence only as an editable starting point the
> human must accept or rewrite, and it is never silently committed.

### 6.2 Subsystem responsibilities

| Subsystem | Responsibility | Reliability bet |
|---|---|---|
| Ingest | Parse line-numbered transcript; attach speaker/role; cheap heuristic noise pre-pass. | High (deterministic). |
| Mine | LLM: atomic **setting-fact** claims with line-IDs + modality — extracts standing world-facts, **excludes session-event/party-action narrative** (§5), and pulls the durable fact out of an event. Bounded cost (per-chunk, not whole-wiki). | Medium — the recall problem; needs eval set (G8). |
| Triage | Present canon/uncertain/noise; human confirms. | High — human in the loop by design. |
| **Resolve entities** | Map each claim's surface forms — including generic referents ("the forest" → the Verdant Expanse) — to a canonical **entity** + existing page (or new-page), using the wiki `aliases:` index + an entity registry; surface low-confidence merges for human confirmation. | Medium — the **biggest single error source** (ASR variance + referents); never auto-merge across a confidence threshold. |
| Locate | Match resolved entity → existing page or new-page proposal (uses a wiki index/summaries, not full text). | Medium. |
| Conflict | Flag contradictions vs. wiki + prior claims, **entity-scoped** (compare only against prior canon sharing a resolved entity — D-11); canon is one shared world across arcs (D-9). | Medium — explicit human resolution. |
| Draft/assemble | Build per-page proposals; optional voice-draft. | Low (voice) — therefore human authors. |
| Review app | All human decisions; rendered-in-context; provenance on hover. | This *is* the product (~70% of effort). |
| Commit | Write prose + provenance; one jj commit. | High (deterministic), but must go through jj. |

## 7. Data model (sketch)

Persisted artifacts (exact storage TBD in the plan; Zod-validated at I/O boundaries as
today). Conceptually:

- **Session identity**: `{ arc, date, transcriptPath, contentHash }` — the durable key is
  `(arc, date)`, **not** the filename stem (the `000` arc reuses one basename across ~30
  files). `contentHash` drives re-ingest when a corrected transcript is re-exported.
- **Entity**: `{ id, canonicalName, aliases: string[], wikiPath?, status: known|pending }` —
  a registry seeded from the wiki's `aliases:` frontmatter and grown as new entities appear.
  Resolution maps claim surface forms to an `entity.id`; low-confidence merges are flagged for
  human confirmation, never auto-merged.
- **Claim**: `{ id, sessionId:(arc,date), text, citations: (transcript,lineId-range)[],
  speaker, role, modality, entityIds: string[], status: proposed|canon|noise|rejected }`
- **Proposal**: `{ id, sessionId, kind: create|amend|correct|retract, targetPaths: string[]
  (>1 for multi-page events), backingClaimIds[], proposedText, conflicts?: ConflictRef[],
  decision: pending|approved|edited|rejected|deferred, finalText? }`
- **Canon Ledger entry** (the durable provenance record): `{ wikiPath, sentenceAnchor,
  sessionId, lineIds[], claimId, approvedAt }` — the machine-readable layer linking a wiki
  sentence to its source. **Survives commit** (it is how cross-session conflict detection and
  retcon history work). Storage decided (D-1): a **render-invisible sidecar** keyed by
  `(wikiPath, sentenceAnchor)` — does not pollute reader-facing prose and keeps aether's
  byte-stable build unchanged; best-effort/self-healing against manual Obsidian edits.
- **Review session state**: per-session decision log so review is resumable (G7/AC-8).

## 8. Wiki format & aether impact

The stakeholders allow **major restructure or additive provenance**, with the inviolable
condition that the **rendered wiki reads as human-quality prose**. This spec chooses the
**additive-provenance** path for v1 (lowest blast radius against a live, byte-stable site)
and reserves structural restructuring for a possible v2:

- **v1 (this spec):** the wiki stays human-authored Obsidian prose. Provenance lives in a
  render-invisible **sidecar** (D-1) that does **not** appear in reader-facing text; aether's
  renderer ignores it (zero render change). An opt-in "show sources" affordance is a possible
  later add.
- **v2 (deferred):** structured canon graph as SSOT with prose as a reviewed projection
  (architecture C). This is a larger aether renderer change and a re-baseline of the 763-file
  build. Out of scope here, but the v1 data model (Canon Ledger) is the on-ramp to it.

> **Hard constraint:** aether is a live site behind Caddy with a byte-stable 763-file build
> output. *Any* change that touches render output must be validated with a build + file-set
> diff and a deliberate re-baseline (see root `CLAUDE.md`). v1's default is **no render
> change**.

> **Decision (D-1, ratified).** Provenance is stored in a **render-invisible sidecar keyed by
> `(wikiPath, sentence-anchor)`**, best-effort and self-healing — the prose, not the sidecar,
> is authoritative for reading. This was chosen over frontmatter (changes aether's render input
> → re-baseline) and inline attributes (changes render output) precisely to keep the **aether
> build byte-stable** with no render change in v1. The one remaining detail for Phase 0a is the
> durable **sentence-anchor** form (§5) — it must survive surrounding manual edits; the Canon
> Ledger's shape and the conflict subsystem depend on it.

## 9. The "good prose" acceptance bar (north star)

The rendered wiki must read as genuine human worldbuilding prose. This bar is enforced
primarily by the reviewer's eye, assisted by cheap automated **warnings** (never gates). The
contrast is calibrated against real pages:

- **GOOD** (verbatim): "Sableclutch is dominated by the dockworkers and warehouse employees
  that ply their trade on the river… somewhat overlooked by the rest of the capital — whilst
  many of the goods that enter into the city start their journey in Sableclutch, the power
  centers of the Orgs that manage it are found elsewhere." → perspectival, states a tension,
  specific-not-listy, idiomatic, economical, wikilink-woven.
- **BAD** (slop archetype): "X is a large scrapyard located within the neighborhood. It is an
  expansive site featuring mountains of trash." → encyclopedic register, dead specificity,
  no POV, no tension, template cadence.

**Reviewer/automated checklist** (applied per proposed sentence):

*Voice & register* — no `{Name} is a {adj} {type} located in {place}` opener; has a point of
view; idiom matches the wiki (literary/British-ish, em-dash asides); no filler intensifiers
("large/vast/expansive/numerous/various") used as meaningless volume.
*Substance & tension* — states a consequence or tension, not just an attribute; specific
without listing; earns its length (pages are tiny — every clause pulls weight).
*Integration (amend)* — reads as one continuous human paragraph (no "human sentence.
bolt-on AI sentence." seam); tense/POV/naming consistent; wikilinks woven in, not a trailing
"see also" dump.
*Provenance & truth* — every claim transcript-cited; an unsourced sentence is a presumptive
hallucination (flagged); says only what the transcript supports; canon, not banter.

**Automatable subset** (surface as warnings only): encyclopedia-opener regex; intensifier
density; "It is …" second-sentence template; unsourced-sentence detector; broken/duplicate
wikilink-target check. These direct attention and feed a **slop-rate metric** (G8); they
never auto-reject.

**Page-type awareness (required).** The corpus is **not uniformly literary prose**, so the
checklist above applies only to lore/character prose pages. The tool must detect page type and
apply the right bar (templates enumerated in `pkg/heartwood/CLAUDE.md`):
- **Lore / character pages** — the literary bar above.
- **Deity stat blocks** — ` :: ` label/value lines, ` <br />` line endings; the prose checks
  (opener regex, "states a tension") must be **suppressed**; structural conformance is checked
  instead.
- **`Timeline.md`** — hand-authored **HTML** (`<ul>/<li>/<div>`, inline styles, era headers);
  not prose. Per D-3 the tool does **not** auto-edit `Timeline.md`; Timeline curation stays
  manual in Obsidian.
- **`<pre>` flavor docs** (logs, letters, transmissions) — verbatim in-world text; voice
  checks do not apply.
- **Stub pages** — frontmatter only; an amend that adds a first body paragraph "graduates" the
  stub and *does* face the prose bar.

> The **slop-rate metric** must not be circular: it is measured against the **reviewer's
> accept/edit/reject decisions** on a held-out eval set (§12), not against the same automated
> warnings that flag the sentences — the warnings are inputs the reviewer may overrule.

## 10. Constraints

- **C1.** Bounded LLM cost — never load the whole wiki or whole transcript into one call;
  chunk and index. Every call logged (cost report, as today).
- **C2.** Human gate — nothing reaches the wiki without explicit per-proposal approval. No
  autonomous commit.
- **C3.** **jj, not git.** The repo is Jujutsu (git-colocated); commits go through jj. Raw
  git can corrupt jj state. One revision per review session.
- **C4.** SSOT discipline — transcripts and wiki are read from `pkg/content/*`; heartwood
  keeps no copies. `Script/` excluded.
- **C5.** Tech baseline — Bun + TypeScript; LLM via `@faerrin/llm` `AnthropicClient` (no
  direct SDK calls); Zod at I/O boundaries; atomic writes; DI for tests.
- **C6.** aether build stays byte-stable unless a render change is a deliberate, re-baselined
  decision (§8).
- **C7.** Provenance must never degrade reader-facing prose.
- **C8.** Identity is structural — session = `(arc, date)`; citation = `(transcript, lineId)`;
  entity = canonical id + aliases. Never derive a unique key from a bare filename stem or a
  bare line number.
- **C9.** Re-ingest is idempotent and re-export-safe — a transcript may be re-exported with
  corrected text (and **renumbered lines**). Re-ingest keys on `contentHash`; existing
  provenance must re-anchor (or be flagged stale) rather than silently pointing at the wrong
  lines. Already-committed-and-approved facts are not re-proposed.

## 11. Acceptance criteria

Priorities: **P0** = the rewrite fails without it; **P1** = should-have; **P2** =
nice-to-have. Given/When/Then.

### P0
- **AC-1 Triage.** Given a freshly ingested session with ~50% banter, when the reviewer opens
  triage, then claims are pre-sorted into Canon/Uncertain/Noise with noise collapsed, and a
  claim can be promoted or discarded in one action.
- **AC-2 Rendered context, not diffs.** Given a proposal, when reviewing, then the default
  view is the page rendered as it will appear on aether with the change highlighted in place;
  a diff view exists behind a toggle.
- **AC-3 Per-sentence citation.** Given any proposed sentence, when the reviewer hovers it,
  then the backing transcript line-IDs and text are shown; a sentence with zero backing lines
  is flagged `unsourced`.
- **AC-4 Edit-in-place.** Given an ~80%-right proposal, when the reviewer chooses Edit, then a
  prose editor opens pre-filled with the proposed text, the surrounding page prose (for voice
  reference), and the pinned source lines; the saved edit becomes the approved text.
- **AC-5 Modality, not "speculative-as-fact".** Given a claim sourced from player speculation
  or in-character fiction, when it is surfaced, then it is labelled with its modality and is
  **not** presented as established canon, and canon proposals are built only from
  canon-modality claims unless the reviewer explicitly promotes one. Per D-10, an
  `in-character-fiction` (or GM-voiced-NPC) claim is proposed as an **attributed** fact
  ("X *claimed* Y"), not the bare proposition, until the reviewer confirms it as true.
- **AC-6 Human gate.** Given proposed changes, when nothing is explicitly approved, then
  nothing is written to the wiki and no commit/PR exists.
- **AC-7 Commit via jj, not PR.** Given approved proposals, when the reviewer commits, then
  changes are written to the local wiki working tree as a single batched commit **through
  jj**, and no GitHub PR or comment thread is created.
- **AC-8 Resume.** Given a partially reviewed session, when reopened, then deferred proposals
  and prior decisions are intact and review resumes where it stopped.
- **AC-9 Voice bar surfaced.** Given a proposed sentence matching the encyclopedia-opener
  template or unsourced, when the reviewer reaches it, then the UI flags it against the §9
  checklist so it is never silently committed. (Verifiable via the *automatable subset* of §9;
  the subjective items are reviewer-facing guidance, not pass/fail gates.)
- **AC-20 Entity / alias resolution.** Given a claim whose surface form matches an existing
  entity by name or alias, when claims are resolved, then it is mapped to that entity's
  canonical page; given an ambiguous or low-confidence match (e.g. an ASR misspelling or a new
  spelling of a known NPC), then the merge is surfaced for one-click human confirm/split and is
  **never** auto-merged silently; confirmed aliases are written back to the entity registry /
  `aliases:` frontmatter.
- **AC-23 Session narrative overview.** Given a reviewed session, when the reviewer opens it,
  then a single **narrative summary** of what happened in-world that session is presented
  (the coherent story the old per-PR-thread surface destroyed), from which the reviewer can
  drill into individual proposals — review is never *only* a flat list of per-page edits.

### P1
- **AC-10 Create-new-page.** Given claims about an entity with no existing page, when
  reviewed, then the proposal offers an editable title + folder-tree path, an opening
  paragraph in wiki voice, and inbound-link suggestions; a page nothing links to is flagged.
- **AC-11 Conflict surfacing.** Given a claim contradicting existing wiki content or a prior
  approved claim (across any arc — canon is one shared world, D-9), when proposals are built,
  then it is flagged Conflict, pulled to the top, shows both statements with sources and their
  originating arcs, and offers **Supersede / Coexist / Reject**; it is never auto-resolved.
  (Per D-3, the tool does not write `Timeline.md` — that curation stays manual in Obsidian.)
- **AC-12 Seamless amend.** Given an amend proposal, when rendered in context, then the new
  prose is shown inside the existing paragraph so the reviewer judges seam/rhythm continuity.
- **AC-13 Wikilink validation.** Given proposed `[[wikilinks]]`, when displayed, then targets
  are checked against the wiki and non-existent/duplicate targets are flagged.
- **AC-14 Noise spot-check.** Given auto-discarded noise, when expanded, then a real fact
  buried in banter can be promoted back to Canon in one action.
- **AC-21 Correct / retract committed canon.** Given a session that contradicts or invalidates
  a previously-committed wiki fact (a retcon, or a correction of an earlier mistaken capture),
  when proposals are built, then a `correct`/`retract` proposal targets the existing sentence
  (located via its provenance), shows what changes and why, and on approval updates the prose
  and the ledger — committed canon is editable, not append-only.
- **AC-22 Multi-page event grouping.** Given one real-world event whose facts touch several
  pages (e.g. a place falls under a faction's control), when proposals are built, then the
  affected per-page changes are grouped as one reviewable event so the reviewer keeps them
  consistent, rather than meeting them as unrelated scattered edits.
- **AC-24 Page-type-aware voice bar.** Given a proposal targeting a non-prose page (deity stat
  block, `Timeline.md` HTML, `<pre>` flavor doc, stub), when the voice checks run, then the
  literary-prose checks are suppressed and the type-appropriate structural checks apply
  instead (§9 page-type awareness).
- **AC-25 Idempotent re-ingest.** Given a transcript re-exported with corrected/renumbered
  lines, when re-ingested, then it is matched by `(arc, date)` + `contentHash`, prior
  provenance into it is re-anchored or flagged stale (never silently misaligned), and
  already-approved facts are not re-proposed.
- **AC-15 Provenance persisted.** Given an approved sentence, when committed, then its
  session + line-ID provenance is recorded in the machine-readable layer without altering the
  reader-facing prose.

### P2
- **AC-16 Rejection reasons → quality log.** Tagged rejections (`out-of-voice`, `not-canon`,
  `wrong-page`, `hallucinated`, `already-known`) feed a tuning log + slop-rate metric.
- **AC-17 Automated slop pre-filters.** Template/intensifier/unsourced/broken-link warnings
  annotate sentences (never auto-reject).
- **AC-18 Session tally.** A live approved/edited/rejected/deferred tally drives the commit
  message.
- **AC-19 Coverage eval.** A hand-labeled eval set yields a measurable recall (coverage) and
  slop-rate number per pipeline change.
- **AC-26 Rejection memory.** Given a claim the reviewer previously rejected, when an identical
  claim recurs in a later session, then it is auto-suppressed from the main queue but remains
  available in a collapsed "previously rejected" tray (D-7) — never silently discarded, never
  re-nagging.

## 12. Evaluation & success metrics (G8)

- **Coverage / recall** — % of hand-labeled canon facts in an eval session that the pipeline
  surfaces as a claim (target set during planning; the old 52% is the baseline to beat).
- **Slop rate** — % of proposed sentences the reviewer rejects/rewrites for voice. Trend must
  fall over time.
- **Review effort** — wall-clock minutes to fully review a session; must beat hand-editing.
- **Precision of canon** — % of canon-modality claims the reviewer confirms (false-canon rate
  must be near zero; this is the "don't treat guesses as fact" guardrail).

## 13. Decisions (resolved 2026-06-06)

All twelve questions are ratified. Each decision is propagated into the sections it governs.

- **D-1 Provenance storage** → **render-invisible sidecar**, keyed by `(wikiPath,
  sentence-anchor)`, treated as best-effort and self-healing (the prose, not the sidecar, is
  authoritative for reading). No frontmatter, no inline attributes → aether build stays
  byte-stable. *(Resolves the §8 blocking decision; the sentence-anchor form is the one
  remaining design detail for Phase 0a.)*
- **D-2 Commit granularity** → **one batched jj commit per review session**, auto-generated
  editable message. *(See C3, AC-7.)*
- **D-3 Retcon recording** → **page only.** The tool updates the page to current truth and
  does **not** auto-write `Timeline.md`. Timeline curation stays a manual Obsidian activity.
  *(Adjusts AC-11 and AC-21 — no Timeline-note action in the conflict UI.)*
- **D-4 Noise discard** → **conservative + tunable, with spot-check.** Only clear banter is
  auto-hidden; borderline lines go to **Uncertain** (reviewer-visible), not Noise. Threshold
  is tunable; bias toward recall. *(See AC-1, AC-14, R9.)*
- **D-5 Voice assistance** → **optional in-voice draft + warn-only critic, human always the
  gate; deferred.** Phase 2 ships **human-authored** prose with the §9 warnings; the draft
  assist is added later (Phase 4) and never auto-commits. *(See §6.1, §16.)*
- **D-6 New-page placement** → **tool proposes title + path; human one-click confirms** via a
  folder-tree picker. Never auto-files. *(See AC-10.)*
- **D-7 Rejection memory** → **auto-suppress identical previously-rejected claims**, but keep
  them in a **collapsed "previously rejected" tray** so nothing is silently lost. *(New
  AC-26.)*
- **D-8 App stack & location** → **standalone local-first app on TanStack Start + React**
  (reuse strider's stack), reading `pkg/content`. **Not** built into the live aether site.
  Open detail: how to render a page "aether-faithfully" without re-implementing Astro/Solid —
  carried into Phase 2 (candidate: render via aether's content pipeline as a library, or a
  thin Markdown renderer validated against aether output). *(See §4, R5.)*
- **D-9 Arc canon scope** → **one shared world canon; every fact tagged with its originating
  arc.** A fact in arc `103` can conflict with one in arc `000`; conflict detection is global,
  not per-arc. *(See §5 Arc, §7, AC-11.)*
- **D-10 In-character fiction** → **record the speech act, attributed** ("NPC X *claimed* Y"),
  not the bare proposition. A claim of `in-character-fiction` (or GM-voiced NPC) modality
  becomes attributed canon; it is promoted to plain fact only on explicit reviewer
  confirmation. *(See §5 modality, AC-5.)*
- **D-11 Conflict-detection retrieval** → **entity-scoped.** A new claim is compared only
  against prior canon sharing one of its resolved entities. Bounded by per-entity history;
  no embedding index in v1. *(See §6.2, C1.)*
- **D-12 Eval set** → the **worldbuilder hand-labels ~2 sessions across ≥2 arcs once** at
  Phase 0b; refreshed only when mining prompts change materially. *(See §12, §16.)*

### Remaining design details (not blocking ratification; for the plan)
- The exact **sentence-anchor** representation (D-1) — must survive surrounding manual edits.
- The **aether-faithful render** strategy for the standalone app (D-8).
These are implementation choices, resolved in Phase 0a/Phase 2, not stakeholder questions.

## 14. Risks

- **R1 Voice is partially unlearnable.** Mitigation: don't bet on generation; human authors;
  measure slop rate; keep edit-in-place frictionless.
- **R2 Coverage is a recall problem.** Mitigation: eval set; conservative noise discard +
  spot-check; iterate on the mine prompt against numbers.
- **R3 Canon conflicts/retcons.** Mitigation: explicit conflict subsystem (AC-11); the Canon
  Ledger makes "which is canon?" answerable.
- **R4 Out-of-tool edits desync provenance.** The worldbuilder also edits in Obsidian.
  Mitigation: provenance is best-effort and self-healing; never block manual edits; treat the
  wiki prose (not the ledger) as authoritative for reading.
- **R5 The review UI is the real product (~70% of effort).** Mitigation: scope the pipeline
  to "good enough to feed a great UI"; invest in the app.
- **R6 Live-site regression.** Mitigation: v1 = no render change; build + file-set diff gate.
- **R7 Entity-resolution errors.** ASR variance makes the same NPC appear under several
  spellings; a bad merge corrupts canon, a bad split fragments it. Mitigation: alias index;
  never auto-merge below a confidence threshold; human-confirm merges (AC-20).
- **R8 Arc/identity collisions.** A bare filename stem is not unique (the `000` arc reuses one
  basename for ~30 sessions). Mitigation: structural identity (C8); one shared arc-tagged canon (D-9).
- **R9 Recall vs. precision in triage.** Aggressive noise discard maximizes review speed but
  risks dropping a real fact buried in banter; conservative discard maximizes coverage but
  re-burdens the reviewer. Mitigation: conservative tunable threshold (D-4) + cheap noise spot-check
  (AC-14), tuned against the eval set.

## 15. Architecture alternatives considered (for the record)

- **A — Canon Ledger + Assisted Authoring (CHOSEN spine).** Machine structures + cites facts;
  human writes all reader prose. Strongest anti-slop, lowest risk, no renderer change.
- **B — Voice-Conditioned Drafted Patch.** Machine drafts whole-page prose in-voice from
  exemplars; human reviews before/after. Reduces writing toil but bets on fragile voice
  fidelity and risks page churn. *Borrowed selectively as the optional, never-auto-committed
  draft step, deferred to Phase 4 (D-5).*
- **C — Two-Layer Canon Graph.** Structured canon as SSOT, prose as a reviewed projection;
  native conflict/retcon detection. Best provenance and conflict handling, but high effort and
  real aether renderer inversion. *Modality tags + cross-session conflict flag borrowed now;
  full graph deferred to v2.*

**Recommendation enacted:** build A as the spine, borrow C's modality + conflict flag, keep
B's draft as an optional assist, defer C's graph/renderer inversion.

## 16. Suggested phasing (non-binding — for the implementation plan)

0. **Phase 0a — Remaining design details.** Stakeholder decisions are all ratified (§13); two
   implementation details remain before Phase-1 code: the durable **sentence-anchor** form
   (D-1) and the **aether-faithful render** strategy for the standalone app (D-8). The ledger
   shape and conflict subsystem depend on the anchor form.
1. **Phase 0b — Eval harness & corpus.** Hand-label one or two sessions across ≥2 arcs; lock
   coverage + slop-rate metrics (G8, §12). *Everything downstream is tuned against this.*
2. **Phase 1 — Mine + triage + resolve + provenance core (headless).** Claims with modality +
   `(transcript,lineId)` citations; noise split; **entity/alias resolution** (AC-20); the
   Canon Ledger with durable sentence anchors; cost-bounded, idempotent re-ingest (C9),
   jj-aware writes. Validate against Phase 0b numbers.
3. **Phase 2 — Review app MVP.** Session list → **narrative overview** (AC-23) → triage →
   rendered-in-context proposal review → citation-on-hover → edit-in-place / approve / reject /
   defer → jj commit. (AC-1–AC-9, AC-20, AC-23.)
4. **Phase 3 — Create-new-page, conflicts, corrections, multi-page events, wikilink
   validation, page-type-aware bar.** (AC-10–AC-14, AC-21, AC-22, AC-24, AC-25.)
5. **Phase 4 — Quality loop + voice assist.** Rejection-reason log, slop pre-filters, coverage
   dashboard, rejection-memory tray, and the deferred optional **in-voice draft + warn-only
   voice critic** (D-5). (AC-16–AC-19, AC-26.)
6. **Phase 5 (deferred) — v2 structured canon graph** if the ledger proves out (§8).

---

### Appendix — grounding artifacts
- Voice calibration: `pkg/content/wiki/Geography/Calaria/Hallia/Sableclutch/index.md`,
  `.../Wrenford.md`, `.../Sableclutch/The Crowded Flea.md`
- Line-numbered transcript (citation primitive):
  `pkg/content/transcripts/000.through-a-song-darkly.2025-10-20.txt`
- Excluded generated pages: `pkg/content/wiki/Script/…`
- Old system being replaced: `pkg/heartwood/CLAUDE.md`
- VCS constraint: root `CLAUDE.md` (jj), live-site constraint: root `CLAUDE.md` (aether/Caddy)
- Constraints memory: `thoughts/shared/memory/heartwood-rewrite-constraints.md`
