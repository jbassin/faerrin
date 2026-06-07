---
title: Heartwood PR Interface — Natural-Language Specification
status: ratified (v1.0, pre-implementation — brainstorm + adversarial completeness pass incorporated; all open questions resolved)
date: 2026-06-06
authors: team-mode spec effort (Claude personas: backend-architect, ux-researcher, devops/contrarian, code-reviewer/adversarial, synthesis)
related:
  - thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md (the rewrite this builds on)
  - thoughts/heartwood/plans/2026-06-06-heartwood-rewrite-implementation.md
  - thoughts/shared/memory/heartwood-rewrite-constraints.md
  - thoughts/shared/memory/heartwood-review-app-architecture.md
  - pkg/heartwood/CLAUDE.md, pkg/heartwood-review/CLAUDE.md (current systems of record)
---

# Heartwood PR Interface — Specification

> **v1.0 note (ratified).** v0.2 incorporated an adversarial completeness pass (a code-reviewer
> persona, grounded in the real code) that corrected load-bearing assumptions; v1.0 ratifies the
> result — all open questions are resolved, with the single merge-method choice (D-15) deliberately
> left to the implementation plan (an implementation detail, not a stakeholder question). The
> corrections folded in: (1) **GitHub's comment/PR-body
> sanitizer strips aether's HTML** (callout `<div>`s, `::` directive output, `<pre>`, inline
> styles), so "rendered prose in the PR body" would silently degrade to GitHub's renderer —
> re-importing the original failure #2. The **deploy-preview is therefore the *primary* fidelity
> surface (P0)**, with an in-body **sanitizer-safe** Markdown rendering as the cheap default (§6.1,
> D-10, AC-2/AC-23). (2) A GitHub merge is **remote**; nothing local triggers canonization, and
> `committedAt`/the provenance sidecar are written only by the *local* commit path — so a
> **merge-canonizer** is required to make a merged PR equal a web-app commit (D-11, AC-21). (3) The
> **session lock** needs an explicit acquire/release protocol **derived from PR-open state** with
> crash recovery (D-13, AC-22). (4) Amends are **full-page replace** (not append); "additive" means
> *additive jj revisions*, and a re-draft yields a **passage** that is woven into the full page
> (D-14, M-fixes in §6/§7). (5) `/defer` has **no ledger state** and contradicts the lock — it now
> **blocks merge** and is resolved after close (D-12). These propagate into §§6–14.

## 0. How to read this document

This is a **natural-language specification (NLSpec)** for a *new feature*: a **GitHub-PR-based
review surface** for the heartwood pipeline, added **alongside** the existing local web review app
([0001 spec](./0001-heartwood-rewrite-spec.md) §2; `@faerrin/heartwood-review`). It defines *what
the PR surface must do* and *why*, not *how to code it*. Acceptance criteria (§11) are the testable
contract. Decisions (§13) record the resolved design choices a prior brainstorm settled.

> **Heavy caveat, stated up front.** The *original, rejected* heartwood shipped GitHub PRs and was
> thrown out for three reasons (0001 §1): review burden (≈37 micro-proposals + inline threads per
> session), wrong surface (diffs are bad for judging worldbuilding **prose**), and no coherent
> session narrative. **Re-introducing a PR surface is only justified if it structurally avoids all
> three.** This spec's design is shaped first and foremost by that constraint (§6, §11 AC-1..3),
> and §14 names the new risks the PR surface introduces and how the design defuses them.

---

## 1. Problem statement

The rewritten heartwood ([0001](./0001-heartwood-rewrite-spec.md)) reviews session-derived wiki
edits through a **local-first web app**. That app is excellent at a desk but it is:

- **machine-bound** — it runs on the worldbuilder's host (`localhost`/LAN); review can't happen
  from a phone, on the move, or asynchronously without that machine running;
- **ephemeral as a record** — decisions live in local state; there is no durable, shareable,
  per-session artifact of "what this session changed in the world" outside the jj history;
- **single-modality** — the only way to review is to sit in the SSR app.

The worldbuilder wants a **second surface**: review the same session as a **GitHub Pull Request** —
async, mobile-friendly, with GitHub's notifications and durable audit trail — *without* re-creating
the failures that killed the original PR-based tool, and *without* weakening the project's
north-star constraint that the rendered wiki reads as genuine human-authored prose (0001 §9).

## 2. Vision (one paragraph)

After a session is ingested, the worldbuilder can open it as a **single Pull Request**. The PR reads
**story-first**: a header line, an in-voice **recap** of what the session revealed, then the
session's **events**, each expanding to the wiki pages it touched — every page showing its proposed
prose **rendered in aether's voice**, not as a `+/-` diff. Clean edits are **pre-checked
checkboxes** he unchecks only where something's wrong (review by subtraction). Canon **conflicts**
arrive as top-level comments he resolves with terse slash-commands (`/keep`, `/replace`,
`/merge <note>`, `/defer`); a local bot re-drafts the affected prose in voice and pushes it to the
PR branch. **The branch is the draft; merging is the act of authorship** — nothing reaches the live
wiki until he merges, and any page he doesn't like he edits in one tap (GitHub's editor, or "open in
workbench" → the web app). The PR and the web app are two windows onto **one** decision ledger.

## 3. Goals & non-goals

### Goals
- **G1.** Let the worldbuilder fully review and land a session **from GitHub**, async/mobile, as one
  PR — an alternative to, not a replacement for, the web app.
- **G2.** Present the session **as a narrative**, not a pile of diffs (retire original failure #3).
- **G3.** Let prose be judged **rendered** (aether-faithful), never as a diff hunk (retire #2).
- **G4.** Keep review cheap: **one PR**, event-grouped, **subtractive** checkbox approval, trivial
  edits collapsed (retire #1).
- **G5.** Keep the human on the pen: auto-drafted prose is **a branch-only draft**; **merge is the
  canonization**, and escape-to-edit is always one tap away.
- **G6.** Resolve canon conflicts in-PR via a small, unambiguous command vocabulary, with the bot
  re-drafting affected prose in voice.
- **G7.** Share **one** decision/provenance model with the web app — a session is never reviewed two
  ways at once; a merged PR is byte-identical to what a web-app commit would have produced.
- **G8.** Touch the live wiki only on **merge**, leaving aether's byte-stable build intact.

### Non-goals
- **N1.** **Not** replacing or deprecating the web app — it remains the peer "workbench" surface.
- **N2.** **No** multi-reviewer / approval-chain workflow (one trusted reviewer, as 0001 N2).
- **N3.** **No** auth hardening beyond an author-login allowlist (single trusted reviewer; see D-3).
- **N4.** **No** GitHub Action / GitHub App hosting model (see D-1) — local bot only.
- **No** autonomous merge: the human always clicks merge (extends 0001 N3 — no autonomous commit).
- **N6.** **No** inline per-line diff comment threads as the review primitive (that was failure #1).
- **No** new mining/triage/voice logic — this surface consumes the existing pipeline output.
- **N8.** **No** change to aether's renderer or the 763-file byte-stable build (0001 C6).

## 4. Actors

| Actor | Description | Relationship to the feature |
|---|---|---|
| **Worldbuilder / GM** | Sole, fully-trusted reviewer; owns the wiki's voice. | Opens, reviews, resolves conflicts on, and merges the PR. Every decision is his. |
| **The local bot** | A long-running local process (`gh` + jj + core), polling the PR. | Builds the PR, renders prose, runs in-voice re-drafts, applies commands, pushes to the branch. Never merges. |
| **Core pipeline (`@faerrin/heartwood`)** | Headless; produces the SessionArtifact + ledger. | Source of proposals, narrative, conflicts; owner of `state/review.ts` (the one ledger) and the provenance sidecar. |
| **The web app (`@faerrin/heartwood-review`)** | The peer review surface. | Shares the ledger; hard-locked read-only for a session whose PR is open (D-4). |
| **GitHub** | Hosts the PR, comments, reactions, checkboxes, merge. | The surface; reached via the `gh` CLI / API. **Not** where automation runs (D-1). |

## 5. Domain glossary (delta over 0001 §5)

Inherits 0001's glossary (Arc, Session `(arc,date)`, Claim, Proposal, Conflict, Canon Ledger,
Provenance, Modality, Sentence anchor). New/!specialized terms:

- **Session PR** — one GitHub Pull Request per session `(arc, date)`, on a dedicated **session
  branch** (`hw/<arc>-<date>`). The unit of PR review.
- **Session branch** — the jj bookmark / git ref the PR is built from. **It is the draft surface**:
  all auto-applied prose and re-drafts live here; the live wiki (`main`) is untouched until merge.
- **Recap** — the in-voice session-narrative paragraph (from `assemble`) that heads the PR body;
  the story the reviewer reads first (the AC-23 narrative of 0001, re-projected into GitHub).
- **Event group** — a set of per-page proposals sharing transcript moments (0001 AC-22,
  `event-groups.ts`); the PR body's primary grouping unit (collapsible).
- **Clean proposal** — a proposal with no unresolved conflict; surfaced as a **pre-checked
  checkbox** in the PR body. Unchecking it = rejecting that page's change.
- **Trivial edit** — a low-substance proposal (e.g. a single mention/date addition) auto-collapsed
  under a count, expandable on demand.
- **Conflict comment** — a top-level PR comment carrying a conflict's existing statement, new
  statement, and context, plus the command menu; bound to its claim by an HTML-comment marker.
- **Command** — a reviewer reply on a conflict comment: `/keep`, `/replace`, `/merge <note>`,
  `/defer`. The only PR-input grammar that drives canon changes.
- **Re-draft** — the bot re-running `draft.ts` for a page after a conflict resolution, committing
  the new prose **additively to the session branch**.
- **Session lock** — a `reviewSurface` marker on a session: while its PR is open, the web app is
  read-only for that session, and vice-versa (D-4). One ledger, one active surface.
- **Render preview** — page prose rendered with `renderWikiMarkdown` (byte-faithful to aether),
  shown in the PR body/comments, **not** GitHub's own Markdown renderer.

## 6. The model

### 6.1 The load-bearing principle

**The PR branch is the draft; merging is the pen-stroke.** This single decision is what lets an
*input surface* (review entirely in GitHub) coexist with the project thesis "keep the human on the
pen" (0001 §6). Auto-applied "draft in voice" prose and every re-draft commit land **only on the
session branch**. The live wiki on `main` changes **only when the human merges** — after reading the
prose rendered, with one-tap escape to hand-edit any page. So the human's authorship act moves from
"typing each sentence" to "reading the rendered result and choosing to merge (or editing first)."

This also fixes the three original rejections **by construction**:
- **Review burden →** one PR, event-grouped, **subtractive** checkboxes, trivial edits collapsed.
- **Wrong surface →** prose is judged **rendered**. Because GitHub sanitizes aether's HTML
  (callouts, `::` blocks, `<pre>`, inline styles), the **aether-faithful** read is a **per-page
  deploy-preview** (the primary fidelity surface, P0); the PR body additionally shows a **GitHub-
  sanitizer-safe** Markdown rendering as a cheap inline default. Raw `+/-` diffs are demoted to the
  Files tab. *(D-10, AC-2/AC-23, R3.)*
- **No narrative →** the body **leads with the recap**, then events → pages (story-first).

### 6.2 Data flow

```
ingested SessionArtifact (proposals + recap + conflicts)  [from 0001 pipeline]
   │
   ▼  [bot: open]    jj bookmark hw/(arc-date) → push → gh pr create
   │                 PR body = header → recap → event groups → per-page RENDERED prose
   │                 clean proposals = pre-checked checkboxes; trivial edits collapsed
   │                 conflicts = top-level comments (existing/new/context + command menu)
   ▼  ┌──────────────────────── GITHUB (the surface) ─────────────────────────┐
      │ reviewer reads recap → events → rendered prose (+ deploy-preview)      │
      │ unchecks bad clean proposals; replies /keep /replace /merge /defer     │
      └───────────────────────────────────────────────────────────────────────┘
   ▼  [bot: poll]    parse commands (allowlisted author) → update state/review.ts
   ▼  [bot: redraft] batch re-run draft.ts for affected pages → additive commit → push
   │                 auto-uncheck any approved block a redraft changed; skip human-edited pages
   ▼  [reviewer]     final read → **Merge** (the canonization)   ── or close (discard session)
   ▼  [bot: canonize] detect merge (poll PR state / jj git fetch) → reconcile main: ensure prose +
   │                 provenance sidecar landed, set committedAt in the ledger, release the lock,
   │                 run the aether build + 763-file diff guard
```

> The provenance sidecar is written **onto the session branch** at PR-open/redraft time (it lives
> outside `wiki/`), so it travels through the merge — but `committedAt` and the live build are
> **local** acts the merge-canonizer must perform (a GitHub merge cannot set them). See D-11/AC-21.

### 6.3 Subsystem responsibilities

| Subsystem | Responsibility | Reuses |
|---|---|---|
| Bot / orchestrator | Open PR, poll, parse commands, drive re-drafts, push, react/ack. | new (`gh` + jj shell), but thin |
| PR body generator | Render the narrative-led body (header, recap, events, per-page rendered prose, checkboxes). | `assemble` recap, `event-groups`, `renderWikiMarkdown` |
| Command engine | Map `/keep /replace /merge /defer` → ledger decisions on a claim. | `state/review.ts` (Accept/Reject), conflict model |
| Re-draft engine | Re-run in-voice draft for affected pages; additive branch commit. | `draft.ts`, `commit-impl` (write + provenance) |
| Lock manager | Acquire/release one active surface per session; **derive validity from PR-open state**; recover stale locks on bot start. | `state/review.ts` (+ a `reviewSurface` field) |
| **Merge canonizer** | Detect the (remote) merge locally; reconcile `main` (sidecar landed, set `committedAt`, release lock); run the aether build + 763-file diff guard. | jj `git fetch`, existing build, `commit-impl` write path |

### 6.4 Mapping onto the existing conflict model

The web app's conflict resolutions (0001 AC-11, reworked to **Accept/Reject**) and the PR commands
are **the same decision** written to the same ledger:

| PR command | Ledger effect | Prose effect |
|---|---|---|
| `/keep` | Reject the conflicting **claim** (drop that fact from its proposal) | page keeps existing canon |
| `/replace` | Accept the claim (fact stays; page flagged a correction) | re-draft the page in voice |
| `/merge <note>` | Accept + attach the note as draft instructions | re-draft, conditioned on the note |
| `/defer` | leave the claim unresolved; flag `deferred`; **blocks merge** | no change; resolved later in the web app **after the PR is closed** (D-12) |

> **Granularity (M-fix).** The ledger keys conflict resolutions **by `claimId`** while clean-proposal
> **checkboxes** are **per-proposal (page)**. A command therefore acts on one claim; a page may carry
> other approved facts whose checkbox is unaffected. `/keep` drops only its claim's fact (the page's
> other facts and its checkbox stand); `/replace`/`/merge` re-draft the page from its *remaining
> non-rejected* facts. This split is testable (AC-25). The current code already maps `accepted`/
> `rejected` per `claimId` (`state/review.ts`); `/keep`→`rejected`, `/replace`|`/merge`→`accepted`.

## 7. Data model (delta over 0001 §7)

- **Session lock**: a `reviewSurface: 'web' | 'pr' | null` (+ `prNumber`, `branch`) on the session's
  review state. **Validity is derived from PR-open state** (the lock holds iff the linked PR is
  open), so a crashed bot can't wedge a session: on start the bot reconciles `reviewSurface` against
  actually-open PRs and clears stale locks (D-13). Acquisition is a compare-and-swap on
  `reviewSurface` (atomic-rename write + re-read) to settle near-simultaneous opens.
- **PR linkage**: `{ arc, date, prNumber, branch, lastBotBookmarkTarget }`. The bot-vs-human commit
  discriminator is **jj-aware** — the bookmark target the bot last pushed (and/or commit author),
  **not** a git SHA (jj churns SHAs on every push) (D-14, AC-10).
- **Deferred conflicts**: `/defer` needs a representable state the ledger lacks today
  (`conflictResolutions` is `accepted`/`rejected` only). Add a `deferred` marker (or an equivalent
  "unresolved + flagged" set); a session with any `deferred` conflict is **not mergeable** (AC-24).
- **Checkbox ↔ proposal binding**: each clean-proposal checkbox carries an HTML marker
  `<!-- hw:proposal <proposalId> -->`; the bot learns an uncheck by **polling PR-body edits** and
  diffing marked checkbox state → a per-proposal decision in the ledger (AC-26).
- **Command audit**: processed `comment.id`s + the resolution each produced (idempotent polling;
  durable audit independent of GitHub's thread state, which force-pushes can mark "outdated"). The
  bot **catches up on any commands posted while offline** on its next poll (AC-13).
- **Conflict comment ↔ claim binding**: an HTML marker `<!-- hw:conflict <claimId> -->` in the
  comment body. No reliance on thread position.
- **Re-draft output**: `draftProse` returns a **passage**, not a whole page; the bot weaves it into
  the page body and writes the page via the existing **full-page-replace** path (`replacePageBody`).
  "Additive" throughout this spec means *additive jj revisions on the branch*, never append-only file
  edits (D-14).
- Everything else (Proposal, Conflict, ledger decisions, provenance sidecar) is **shared** with the
  web app.

## 8. Wiki / aether / VCS impact

- **VCS is jj** (git-colocated; 0001 C3). The PR branch is a **jj bookmark** pushed with
  `jj git push`; **never raw git** (it corrupts jj state). One bookmark + one PR per session.
- **Provenance sidecar is included in the PR.** It lives outside `wiki/`
  (`pkg/content/.heartwood/provenance/`), so it can't perturb aether's byte-stable 763-file build
  (0001 D-1/C6). Including it makes a merged PR **byte-identical** to a web-app commit.
- **The live wiki changes only on merge.** No render-output change occurs while the PR is open
  (it's a branch). The merge-canonizer (D-11) runs the normal aether build + 763-file diff after it
  detects the merge (same gate as a web-app commit).
- **Merge method + post-merge jj reconciliation must be specified** (a GitHub squash vs merge-commit
  produces different histories; the colocated jj repo must end consistent after `jj git fetch`).
  Decided in D-15.
- **Page writes are full-page replace** (`replacePageBody`, the current amend strategy), preserving
  frontmatter; the re-draft passage is woven into the body before the replace (§7, D-14).

## 9. Constraints

- **C1.** One PR per session; identity is `(arc, date)` (never a filename stem) — 0001 C8.
- **C2.** Human gate preserved: **merge is the only path to canon**; no autonomous merge.
- **C3.** jj, not git; one bookmark/PR per session; additive commits; **no force-push that
  discards human commits on the branch**.
- **C4.** SSOT: read transcripts/wiki from `pkg/content/*`; `Script/` excluded (0001 C4).
- **C5.** LLM only via the core `complete()` (`draft.ts`); every call cost-logged (0001 C5/C1).
- **C6.** aether build stays byte-stable; render-affecting change only on merge, via the existing
  build, with the sidecar kept outside `wiki/` (0001 C6).
- **C7.** **One ledger, one active surface** per session — the lock (D-4) is mandatory, not advisory,
  and its validity is **derived from PR-open state** so a crash can't wedge a session (D-13).
- **C8.** Aether-faithful prose is judged via the **deploy-preview**; any prose shown *in the PR
  body/comments* must be a **GitHub-sanitizer-safe** rendering (raw aether HTML is stripped by
  GitHub). Never rely on GitHub's own Markdown renderer for fidelity (it mis-renders `::` deity
  blocks, `<pre>` flavor docs, HTML Timeline pages). *(D-10, AC-2/AC-23.)*
- **C9.** Commands act only on the allowlisted reviewer's `author.login`; all else ignored (D-3).
- **C10.** Canonization is a **local** act: a GitHub merge alone changes nothing on the host. The
  merge-canonizer detects the merge, sets `committedAt`, verifies the sidecar landed, releases the
  lock, and runs the aether build (D-11).
- **C11.** Exactly **one open PR per session**; the bot detects/refuses a second (AC-27).

## 10. The "good prose" bar (inherited)

The §9 bar of 0001 is unchanged and is enforced the same way: by the reviewer's eye on **rendered**
prose, assisted by the automatable voice warnings. In the PR surface those warnings appear as a
short annotation under a page's rendered prose (informational, never blocking). Page-type awareness
(0001 AC-24) still suppresses literary checks on deity/Timeline/flavor pages.

## 11. Acceptance criteria

Priorities: **P0** = the surface fails without it; **P1** = should-have; **P2** = nice-to-have.

### P0
- **AC-1 One PR, narrative-led (retires failure #3).** Given an ingested session, when the bot opens
  its PR, then the PR body leads with a header (counts) and the in-voice **recap**, followed by
  **event-grouped** collapsible sections — not a flat list of file diffs.
- **AC-2 Rendered prose, not diffs (retires failure #2).** Given a proposal in the PR, when the
  reviewer reads it, then a **per-page deploy-preview link** offers the **aether-faithful** rendering
  (the primary fidelity surface), and the PR body additionally shows a **GitHub-sanitizer-safe**
  inline rendering of the prose; the raw `+/-` diff is demoted to the Files tab. Fidelity must not
  depend on GitHub's own Markdown renderer (AC-23).
- **AC-3 Subtractive, low-burden review (retires failure #1).** Given the PR, when opened, then clean
  proposals are **pre-checked checkboxes**, trivial edits are collapsed under a count, and the
  reviewer rejects a page's change by **unchecking** it — no per-line comment threads required.
- **AC-4 Branch-is-the-draft / merge-is-canon.** Given auto-applied or re-drafted prose, when it is
  produced, then it is committed **only to the session branch**; the live wiki (`main`) is unchanged
  until the reviewer **merges** the PR.
- **AC-5 Conflicts as commands.** Given a conflict, when surfaced, then it is a **top-level comment**
  (existing + new + context + menu); when the reviewer replies `/keep`, `/replace`, `/merge <note>`,
  or `/defer`, then the bot records the matching decision in the shared ledger and acknowledges
  (👀→✅) — `/keep`≈Reject, `/replace`|`/merge`≈Accept, `/defer` leaves it for the web app.
- **AC-6 Re-draft on resolve.** Given an Accepted conflict (`/replace` or `/merge <note>`), when the
  bot processes it, then it re-runs `draft.ts` for the affected page(s) and pushes the new prose to
  the branch; `/merge <note>` conditions the draft on the note.
- **AC-7 One ledger, hard lock.** Given a session whose PR is open, when the reviewer opens that
  session in the web app, then the web app is **read-only** for it (and opening in one surface locks
  the other); both surfaces read/write the same `state/review.ts`. Acquisition is a compare-and-swap
  on `reviewSurface` so two near-simultaneous opens settle to one winner.
- **AC-8 Merge = web-app-equivalent commit.** Given a merged-and-**canonized** PR (AC-21), then
  `main` carries the approved prose **and** the provenance sidecar, **byte-identical** to what a
  web-app commit for that session would have produced, and aether's other 763 build files are
  unchanged.
- **AC-9 jj-safe, additive revisions.** Given any PR update (open or re-draft), when the bot pushes,
  then it uses **jj** (`jj git push`, never raw git) and adds **new jj revisions** (history is never
  rewritten to discard the reviewer's own commits on the branch). *("Additive" = jj revisions, not
  append-only file edits — page writes are full-page replace, §7/§8.)*
- **AC-21 Merge canonizer (the local trigger).** Given the reviewer merges the PR on GitHub, when the
  local merge-canonizer next runs (poll PR state / `jj git fetch` detecting the bookmark merged),
  then it reconciles `main`: confirms the prose + provenance sidecar landed, **sets `committedAt`**
  in the ledger, **releases the session lock**, and runs the **aether build + 763-file diff guard**.
  A merge with the canonizer never run leaves `committedAt` unset and the live site unbuilt — so this
  step is mandatory, not optional. *(Closes the "GitHub merge is remote, canonization is local" gap.)*
- **AC-22 Lock is crash-safe.** Given the bot crashes with a PR open, when it restarts, then it
  reconciles `reviewSurface` against actually-open PRs and **clears any stale lock**; a session is
  never permanently wedged read-only by a dead bot. Lock validity is **derived from PR-open state**.
- **AC-23 GitHub-sanitizer-safe rendering.** Given prose shown in the PR body or a comment, when it
  renders on GitHub, then it uses a representation **verified to survive GitHub's HTML sanitizer**
  (raw `renderWikiMarkdown` HTML is stripped); the **aether-faithful** read is the deploy-preview
  (AC-2/AC-18). A test must assert the chosen in-body representation round-trips through GitHub's
  sanitizer without losing structure.

### P1
- **AC-10 Don't clobber human edits.** Given the reviewer hand-edited a page on the PR (Files tab or
  a pushed commit), when a later re-draft would touch that page, then the bot **skips** it and
  comments that it left the human's edit alone (detected via the jj-aware bot-vs-human
  discriminator `lastBotBookmarkTarget`/author, not a git SHA — §7, D-14).
- **AC-11 Re-draft invalidation.** Given an approved (checked) clean proposal whose prose a later
  re-draft changes, when that happens, then the bot **auto-unchecks** it and flags "re-read, this
  changed" — nothing approved silently mutates.
- **AC-12 Batch re-drafts.** Given several conflict resolutions in a short window, when the bot acts,
  then it batches them into **one** re-draft pass per affected page (bounded churn + notifications).
- **AC-13 Command binding + idempotency.** Given a reply on a conflict comment, then it resolves to
  the correct claim via the `<!-- hw:conflict … -->` marker, and re-reading the same comment on the
  next poll does **not** re-apply it (processed-id audit).
- **AC-14 Authorized commands only.** Given a command from any login other than the allowlisted
  reviewer, when polled, then it is ignored (no canon effect).
- **AC-15 Escape to authoring.** Given a page whose draft is off-voice, when the reviewer wants to
  fix it, then he can edit it in the GitHub Files tab or via an **"Open in workbench ↗"** link to the
  web app — one tap, no command needed.
- **AC-16 Event grouping & trivial collapse.** Given proposals that share an event, when rendered,
  then they appear under one collapsible event block; trivial edits collapse under a count (0001
  AC-22).
- **AC-17 Close = discard.** Given an open session PR, when the reviewer **closes** it without
  merging, then no wiki change occurs and the session lock is released (re-openable in either
  surface).
- **AC-24 Command edge cases.** Given malformed/edge command input, when polled, then: a command on a
  non-conflict comment is ignored; multiple commands in one comment → only the first is honored (rest
  flagged); a re-issued/duplicate command is idempotent; `/merge` with an empty note degrades to
  `/replace`; a command on an already-resolved conflict **re-resolves** it (last write wins) and
  triggers a re-draft; a `/defer` conflict **blocks merge** and is resolvable only in the web app
  after the PR is closed (D-12). There is a way to **reverse** a command (re-issue a different one
  while the PR is open).
- **AC-25 Command vs checkbox granularity.** Given a page whose proposal carries multiple facts where
  one has a conflict, when the reviewer `/keep`s that conflict, then only that **claim's** fact is
  dropped; the page's other facts and its **checkbox** are unaffected (commands are per-claim,
  checkboxes per-proposal — §6.4).
- **AC-26 Checkbox uncheck detection.** Given the reviewer unchecks a clean proposal's checkbox, when
  the bot next polls **PR-body edits**, then it maps the box to its proposal via the
  `<!-- hw:proposal … -->` marker and records the rejection in the ledger; checkbox state and the
  ledger never silently diverge (ledger is authoritative).
- **AC-27 Lifecycle safety.** Given (a) a second PR is attempted for an open session → refused; (b)
  `main` advances under the branch causing a merge conflict the bot can't auto-resolve → the bot
  rebases the bookmark and, if prose conflicts remain, **blocks merge and flags it** rather than
  guessing; (c) commands posted while the bot was offline → **caught up** on the next poll
  (idempotently); (d) a closed PR's session re-opened → a fresh branch (no stale-branch prose leaks).

### P2
- **AC-18 Deploy-preview build (mechanism behind AC-2 fidelity).** Given a page under review, when the
  reviewer taps its preview link, then a branch deploy-preview of the **aether-rendered** page is
  available (mobile-faithful). *Note: AC-2/AC-23 make this the primary fidelity surface; it is listed
  here because the hosting/build mechanism (a per-branch aether build + preview host) is the heavier,
  later-phase part — but the **link/preview is effectively P0** for the surface to beat raw diffs.*
- **AC-19 Status surfacing.** Given a session PR, when the reviewer scans the PR list, then labels
  (`needs-conflicts` / `redrafting` / `ready-to-merge`) convey state without opening it.
- **AC-20 Re-ingest reconciliation.** Given a session re-ingested after its PR opened, when the
  proposal set changes, then the bot reconciles the branch (additively where possible) and flags what
  changed rather than silently diverging.

## 12. Evaluation & success metrics

- **Review effort** — wall-clock minutes to land a session via PR; must beat the web app for the
  async/mobile case (and not regress the original PR tool's burden).
- **Redraft-acceptance rate** — % of machine re-drafts merged without a human edit (validates the
  operating assumption, D-5; if low, reconsider the whole surface — see §14 R1).
- **Voice-drift guard** — slop rate (0001 §12) measured on PR-merged sessions must track the web
  app's, not exceed it.
- **Surface-integrity** — zero incidents of divergent canon from dual-surface review (lock holds).

## 13. Decisions (resolved 2026-06-06 via brainstorm)

- **D-1 Mechanism → local `gh`-polling bot.** Not a GitHub Action/App: only a local process has
  access to jj, the provenance sidecar, the core ledger, and `complete()`. The bot reuses
  `draft.ts`, `renderWikiMarkdown`, `assemble`, `event-groups`, `commit-impl`, `state/review.ts`.
- **D-2 Branch-is-the-preview.** No separate preview-before-commit step; re-drafts commit additively
  to the session branch, and **the branch is the preview**. Merge is the gate. *(Drives AC-4.)*
- **D-3 No auth hardening.** Single trusted reviewer → an `author.login` allowlist is sufficient; no
  signed commands. *(N3, C9, AC-14.)*
- **D-4 PR hard-locks the session.** One shared ledger is the single source of truth; while a PR is
  open the web app is read-only for that session (and vice-versa). *(C7, AC-7.)*
- **D-5 Operating assumption: redrafts mostly accepted.** Most machine re-drafts are taken as-is, and
  hand-editing the rest is cheap (Files tab / workbench). The surface is built on this; the
  redraft-acceptance metric (§12) tests it. *(Frames §14 R1.)*
- **D-6 No cost ceiling on re-drafts.** Re-drafts are unbounded per session; cost is logged, not
  capped.
- **D-7 Commands are a fixed vocabulary.** `/keep`, `/replace`, `/merge <note>`, `/defer` — free-text
  is fed to the LLM **only** inside `/merge <note>` (scoped, low-risk), replacing the original
  fragile free-text `approve <instructions>`.
- **D-8 Provenance sidecar travels in the PR**, outside `wiki/`, so a merged PR equals a web-app
  commit and aether stays byte-stable. *(AC-8, §8.)*
- **D-9 Web app is a peer, not deprecated.** Two surfaces, one core/ledger; the PR is the async
  "lounge", the web app the "workbench". *(N1.)*
- **D-10 Fidelity via deploy-preview; in-body is sanitizer-safe.** GitHub strips aether's HTML, so
  the aether-faithful read is the **per-page deploy-preview** (primary, P0-critical); the PR body
  carries only a **GitHub-sanitizer-safe** Markdown rendering. A Phase-0 spike must verify what
  survives GitHub's sanitizer before this surface is built. *(Corrects the v0.1 assumption; AC-2/23.)*
- **D-11 Merge canonizer (canonization is local).** A GitHub merge is remote and sets nothing on the
  host. A local merge-canonizer detects the merge, sets `committedAt`, verifies the sidecar landed,
  releases the lock, and runs the aether build + diff. *(C10, AC-21.)*
- **D-12 `/defer` blocks merge.** `/defer` needs a `deferred` state the ledger lacks today; a session
  with a deferred conflict is **not mergeable**, and the conflict is resolved in the web app **after
  the PR is closed** (so it doesn't contradict the lock). *(Resolves the `/defer`-vs-lock conflict;
  AC-24, §7.)*
- **D-13 Lock derived from PR-open + crash recovery.** The lock holds iff the linked PR is open;
  acquisition is a compare-and-swap; the bot reconciles/clears stale locks on start. *(C7, AC-22.)*
- **D-14 Re-draft = passage woven into a full-page replace.** `draftProse` returns a passage, not a
  page; the bot weaves it in and writes via `replacePageBody`. "Additive" = additive **jj
  revisions**, never append-only file edits. *(Corrects v0.1 "additive prose"; §7/§8, AC-9.)*
- **D-15 Merge method = TBD-at-plan, with post-merge `jj git fetch` reconciliation.** Choose
  merge-commit vs squash and specify how the colocated jj repo ends consistent after the merge is
  imported. *(C10, §8; the one decision deliberately left to the implementation plan.)*
  → **Resolved (2026-06-06, in the plan): squash merge** + a `jj git fetch` → verify-content →
  abandon-local-branch reconciliation. Squash gives **one `main` commit per session** (matching the
  web app's one-batched-revision model, AC-8) and the simplest jj reconciliation (a squash commit is
  independent — fetch it, verify the prose+sidecar tree, abandon the redundant local branch revs).
  Repo config: allow **squash-only** merges; bot sets PR title = the canonical commit-message
  subject. See the implementation plan's "D-15 RESOLVED" section.

## 14. Risks

- **R1 Voice drift / approval bias (the existential risk).** Auto-applied prose the human only
  *reviews* (vs *authors*) can drift the wiki toward the LLM's idea of the voice — undetectable
  per-session, costly to reverse. **Mitigation:** branch-is-the-draft + **merge-is-authorship**
  (D-2) means nothing is canon until the human reads it rendered and merges; **escape-to-edit**
  (AC-15) keeps the pen reachable; the **slop/redraft-acceptance metrics** (§12) make drift
  measurable; if acceptance is low, the surface is reconsidered (the "output-gate" alternative in the
  brainstorm). This risk is **accepted, instrumented, and reversible** — not ignored.
- **R2 Re-draft thrash.** Resolving conflicts mutates prose, which can re-open already-approved
  blocks and re-notify — the original "death by a thousand reviews" spread over time. **Mitigation:**
  batch re-drafts (AC-12), tight invalidation scoped to changed blocks (AC-11).
- **R3 GitHub renderer ≠ aether renderer.** Judging prose on GitHub's Markdown would re-import
  failure #2 for non-prose pages. **Mitigation:** the deploy-preview is the faithful surface; in-body
  is sanitizer-safe only (C8, D-10, AC-2/AC-23/AC-18).
- **R4 Dual-surface divergence.** Same session reviewed in both surfaces → conflicting decisions,
  double provenance writes, jj/GitHub drift. **Mitigation:** the hard lock (D-4/D-13, AC-7/AC-22) +
  one ledger.
- **R5 jj/GitHub state drift.** Force-pushes/rewrites desync the bot's pointer and GitHub's thread
  state. **Mitigation:** additive jj revisions (AC-9), the jj-aware `lastBotBookmarkTarget`
  discriminator, processed-id audit (AC-13), marker-bound comments/checkboxes (no reliance on GitHub
  thread state), and a specified merge method + post-merge fetch reconciliation (D-15).
- **R6 Cargo-culting the rejected PR tool.** **Mitigation:** AC-1..3 are written specifically as the
  anti-patterns of the three original failures; if a build can't satisfy them, it must not ship.
- **R7 GitHub HTML sanitization (load-bearing).** GitHub strips aether's HTML, so naive "rendered
  prose in the PR body" silently degrades to GitHub's renderer — the very failure #2 the surface
  exists to avoid. **Mitigation:** deploy-preview as the faithful read + a verified sanitizer-safe
  in-body representation, gated by a **Phase-0 spike** that proves what survives before anything is
  built (D-10, AC-23). *If nothing acceptable survives and deploy-preview proves infeasible, the
  feature should not ship as an input surface — fall back to the output-gate model.*

## 15. Suggested phasing (non-binding)

0. **Phase 0 — De-risk the blockers first.** (a) **Sanitization spike** (R7/D-10/AC-23): prove what
   prose representation survives GitHub's sanitizer + stand up a per-branch aether deploy-preview;
   if neither gives faithful prose, stop and reconsider the surface. (b) **Bot skeleton + lock**:
   local `gh`-polling bot; PR-open-derived `reviewSurface` lock with crash recovery (AC-7/AC-22);
   open/close a session PR on a jj bookmark (AC-9/AC-17). (c) **Merge canonizer** spike: detect a
   merge locally, set `committedAt`, land the sidecar, run the build + diff (AC-21, D-11/D-15).
1. **Phase 1 — Narrative-led read surface (P0 read path).** PR body generator: header → recap →
   event groups → per-page **sanitizer-safe** prose + **deploy-preview** links; trivial collapse;
   clean-proposal checkboxes with markers + uncheck detection (AC-1/2/3/23/26). No conflict commands
   yet; merge → canonizer writes prose + sidecar + sets `committedAt` (AC-4/8/21).
2. **Phase 2 — Command engine + re-draft.** `/keep /replace /merge /defer` → ledger (per-claim) →
   batched in-voice re-drafts (passage woven via full-page replace); ack handshake; invalidation +
   don't-clobber + edge cases + `/defer` blocks merge (AC-5/6/10/11/12/13/14/24/25).
3. **Phase 3 — Polish + lifecycle.** Escape-to-workbench links, status labels, re-ingest + base-
   advanced + offline-catch-up + one-PR enforcement (AC-15/16/19/20/27).
4. **Phase 4 — Validate the bet.** Measure redraft-acceptance + slop on real sessions (§12, D-5);
   decide whether to keep, tune, or fall back to an output-gate model.

---

### Appendix — grounding artifacts
- The rewrite this extends: `thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md` (AC-1..26,
  D-1..12, the §9 prose bar, the three original rejections).
- Reused code: `pkg/heartwood/src/pipeline/{draft,assemble}.ts`,
  `pkg/heartwood-review/src/render/renderWikiMarkdown.ts`,
  `pkg/heartwood-review/src/lib/event-groups.ts`,
  `pkg/heartwood-review/src/server/commit-impl.ts`,
  `pkg/heartwood/src/state/review.ts` (the shared ledger).
- Constraints: root `CLAUDE.md` (jj, live aether/Caddy), `pkg/heartwood-review/CLAUDE.md`
  (render fidelity, byte-stable build, the two load-bearing server-fn rules).
