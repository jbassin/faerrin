# Heartwood Review — User Guide

A complete, start-from-nothing guide to reviewing Pathfinder 2e session transcripts into
worldbuilding-wiki edits with **Heartwood Review** (`@faerrin/heartwood-review`).

This guide assumes **no prior knowledge of the repo**. If you can open a terminal and a web
browser, you can follow it. For the _why_ behind the design, see the spec
(`thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md`); for developer/internals detail, see
[`CLAUDE.md`](./CLAUDE.md). This guide is about _using_ the tool.

---

## 1. What this is (in one minute)

After a tabletop session is recorded and transcribed, you have a long, messy transcript — roughly
**half of it is out-of-character banter** (scheduling, jokes, rules lookups). Buried in the rest
are facts about the game world: who someone is, what a place is like, what changed. Those facts
belong in a hand-maintained Obsidian **wiki** (rendered as the live site `heart.iridi.cc`).

Doing that by hand is slow. Heartwood automates the _mechanical_ half and keeps **you** on the
_creative_ half:

- A **headless pipeline** (`@faerrin/heartwood`) reads one transcript, throws out the banter,
  extracts atomic **facts** (each cited back to exact transcript lines), figures out which wiki page
  each touches, and flags contradictions with what's already written. This is the expensive,
  AI-backed step. It runs **once per session**.
- The **review app** (`@faerrin/heartwood-review`, this package) is where you sit down and review
  the result: read each proposed change **rendered as it will look on the wiki**, confirm it against
  the cited transcript lines, **write or edit the prose in your own voice**, and approve.
- When you're done, the app writes your approved prose to the wiki and records it as **one commit**
  — through **jj** (the version control system), locally. **No GitHub pull requests.**

The guiding rule: **the machine structures and cites; you keep the pen on the prose.** Nothing ever
reaches the wiki without your explicit, per-change click.

```
 transcript ──▶  heartwood pipeline  ──▶  Heartwood Review app  ──▶  wiki + one jj commit
 (~50% noise)    mine·triage·resolve      (you read, edit,            (your approved prose,
                 ·assemble·conflict        approve in your voice)       + machine provenance)
                 [runs once, uses AI]      [this package]              [local, no PRs]
```

---

## 2. Before you start — prerequisites

You need four things installed/available. Check each:

| Need                                             | Why                                                                                                                               | Check it                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **[Bun](https://bun.sh)** ≥ 1.3                  | Runs everything (this is a Bun repo, not Node/npm).                                                                               | `bun --version`                                                   |
| **[jj (Jujutsu)](https://github.com/jj-vcs/jj)** | The app commits approved edits through jj.                                                                                        | `jj --version`                                                    |
| **The `faerrin` repo, cloned**                   | Holds the wiki, transcripts, and this app.                                                                                        | `ls pkg/heartwood-review`                                         |
| **An Anthropic API key**                         | Needed to **ingest** a session (the AI step) and to use the optional "draft in voice" button. _Not_ needed just to browse the UI. | a key from [console.anthropic.com](https://console.anthropic.com) |

> **Why jj and not git?** This repo is managed with Jujutsu (git-colocated). Running raw `git`
> commands can corrupt its state. You don't have to _learn_ jj to use this app — the app runs jj for
> you — but it must be installed.

---

## 3. One-time setup

From the **repo root** (the directory that contains `pkg/`):

```sh
# 1. Install all dependencies for the whole workspace (one command, one lockfile).
bun install

# 2. Give the pipeline your Anthropic key. The key lives in the heartwood (core) package.
cp pkg/heartwood/.env.example pkg/heartwood/.env
#   then edit pkg/heartwood/.env and set:
#     ANTHROPIC_API_KEY=sk-ant-...
```

That's it. You do **not** need to configure a database, a server, or any GitHub credentials — there
are none.

> **Optional — the "draft in voice" button.** The review app can ask the AI for a first-draft
> sentence (see §6.4). That single feature also needs the key _in the app's own environment_. If you
> want it, either create `pkg/heartwood-review/.env` with the same `ANTHROPIC_API_KEY=…` line, or
> `export ANTHROPIC_API_KEY=…` in the terminal before you launch the app. Everything else works
> without it.

---

## 4. Quick start — see the app with zero cost

Before spending any AI budget, you can load the app with **offline sample data** to learn the
interface. Two terminals (or two commands) from the repo root:

```sh
# 1. Write a realistic sample session (no AI, no cost).
bun run --filter @faerrin/heartwood-review dev:fixture

# 2. Start the app.
bun run --filter @faerrin/heartwood-review dev
```

Then open **<http://localhost:3001>** in your browser. (The app also binds to your LAN — the
terminal prints a `Network:` URL — so you can review from a tablet on the same Wi-Fi.)

You'll land on the **session list**. Click the sample session and explore the review surface
described in §6. Nothing you do here can harm the real wiki until you reach **Commit** (§7), and
even then the sample points at safe fixture data.

To stop the app, press `Ctrl-C` in the terminal running `dev`.

---

## 5. The real workflow at a glance

```
  ① ingest a session   →   ② open the app   →   ③ review each change   →   ④ commit   →   ⑤ check the dashboard
   (AI, once)               (localhost:3001)      (read · edit · approve)   (one jj rev)    (coverage & slop)
```

The rest of this guide walks each step.

---

## 6. Reviewing a session

### Step ① — Ingest the session (the AI step, run once)

First, find the session you want. Transcripts live in `pkg/content/transcripts/`, named
`<arc-number>.<arc-name>.<date>.txt`:

```sh
ls pkg/content/transcripts/
# e.g.  000.through-a-song-darkly.2025-10-20.txt
```

A session is identified by its **arc** (the name, e.g. `through-a-song-darkly`) and its **date**
(e.g. `2025-10-20`). Ingest it:

```sh
bun run --filter @faerrin/heartwood ingest through-a-song-darkly 2025-10-20
```

This runs the whole pipeline (mine → triage → resolve → assemble → conflict) and saves a
**SessionArtifact** the app reads. It makes several AI calls and may take a minute or two; cost is
logged. You only do this **once per session** — the app never re-runs it on a page load.

> Dates are forgiving: `2025-10-20` and `2025-10-2` both work.
> Re-ingesting the same transcript is safe and idempotent.

### Step ② — Open the app and pick the session

```sh
bun run --filter @faerrin/heartwood-review dev
```

Open <http://localhost:3001>. The **session list** shows every ingested session with a status badge:

- **Unreviewed** — you haven't decided anything yet.
- **In progress** — some decisions made; deferred/pending remain.
- **Reviewed** — every proposal reached a final decision.

Click a session to open the **review surface**.

### Step ③ — The review surface, top to bottom

**Session narrative (top).** A short, plain-language summary of what the session revealed about the
world — your orientation before diving into individual edits. (This is _not_ wiki prose; it's a
reading aid.)

**Conflicts (if any, pulled to the top).** When a new fact contradicts something already on the wiki
(even from a different arc — the world's canon is shared), it's flagged here with **both**
statements and their sources. Each contradicting fact already belongs to that page's proposal; you
decide what to do with it (nothing is auto-resolved):

- **Accept** — the new fact is right. It stays in the page's proposal, which is now flagged as
  **changing existing canon** (a correction); you reconcile the old and new wording when you edit
  the full page. The conflict collapses into a **Resolved conflicts** tray.
- **Reject** — the new fact is wrong. It's **dropped from the proposal** entirely (it won't be
  committed or shown); if it was the proposal's only fact, that proposal disappears. The conflict
  also collapses into the Resolved tray.

The tray is reversible — expand it and change a choice to bring a conflict back.

**Two tabs:**

- **Proposals** — the per-page changes to review (the main work). See §6.1–§6.6.
- **Triage** — the raw mined facts sorted into **Canon / Uncertain / Noise**. See §6.7.

**Live tally + Commit bar (bottom).** A running count of approved / rejected / deferred / pending,
and the green **Commit** button (§7).

---

#### 6.1 Anatomy of a proposal card

Each card is one proposed change to one wiki page. It shows:

- A **title** and whether it will **amend → an existing page** or **create a new page**.
- The **source facts** that back it — each as a bullet with one or more **citation chips**. Hover a
  chip to see the exact transcript lines and text it came from (this is local and instant — no AI).
  A fact whose modality isn't plain canon is tagged (e.g. `[player-speculation]`,
  `[in-character-fiction]`) so a guess is never mistaken for established fact.
- Three **view tabs**: **Edit**, **Reading**, **Diff**.
- A **prose editor** (in Edit view) — _this is where you write_.
- **Voice warnings** under the editor (non-blocking; see §6.5).
- **Decision buttons**: Approve / Reject / Defer.

#### 6.2 The three views

- **Edit** — the working view. For an **amend**, the editor is **pre-populated with the existing
  page text**, so you edit the whole page in place. For a **create**, it starts empty.
- **Reading** — the full page **rendered exactly as it will appear on the wiki**. This is how you
  judge prose: by reading it in context, not as a diff.
- **Diff** — a line view of your changes: `+` for lines you added, `-` for lines you removed,
  unchanged lines as context (for an amend, measured against the original page).

#### 6.3 Writing the prose (edit-in-place)

The tool deliberately does **not** auto-write wiki prose — _you_ do, because the wiki has a real
literary voice an AI can't reliably match.

For an **amend**, the editor loads the **current page text**. You add the new information directly
where it belongs — rewrite a sentence, extend a paragraph, drop in a new one — and your edited text
**becomes the new page** on commit. (The page's frontmatter, e.g. `aliases:`, is preserved
automatically; you only edit the body.) This is the most natural way to keep the voice seamless:
you're editing real prose, not bolting a fragment onto the end.

Two helpers add raw material without wiping your work — both **append** to what's in the editor:

- **append facts** — drops the raw fact sentences at the end, to weave in and rewrite.
- **✨ draft in voice** — asks the AI for a short in-voice passage and appends it (see §6.4).

Edit freely until the **Reading** view reads like something you'd have written by hand. For a
**create**, a **folder-tree picker** lets you choose the new page's title and path, and the app
suggests existing pages that mention the subject (so the new page isn't an orphan nothing links to).

#### 6.4 The "draft in voice" assist (optional, AI)

Clicking **✨ draft in voice** generates **one** candidate passage from the cited facts and appends
it to the editor, outlined in purple. It is **a starting point only**:

- It is **never** committed as-is and **never** bypasses your approval — you must still edit and
  Approve.
- The moment you type, the purple "draft" marker clears — it's your prose now.
- It needs `ANTHROPIC_API_KEY` in the app environment (§3). Without it, the button reports a clear
  error and you simply write the prose yourself.

#### 6.5 Voice warnings (the prose critic)

As you type, lightweight, **non-blocking** warnings appear — e.g. an "encyclopedia opener" (`X is a
large … located in …`), filler intensifiers (_large/vast/numerous_), a broken `[[wikilink]]` target.
They direct your eye toward the house style; they never stop you from approving. On non-prose pages
(deity stat blocks, `<pre>` flavor docs, the HTML Timeline), the literary checks are automatically
suppressed and only structural checks apply.

#### 6.6 Deciding: Approve / Reject / Defer

- **Approve** — your authored prose for this change is locked in (but still **not written to the
  wiki** until you Commit).
- **Reject** — opens a small **reason picker**: _out of voice · not canon · wrong page ·
  hallucinated · already known_. The tag feeds the quality dashboard and the rejection memory
  (below). You can also "reject without a reason."
- **Defer** — skip it for now; it stays pending and you can come back.

**Previously rejected (the rejection-memory tray).** If a claim you rejected in an _earlier_ session
shows up again, the app doesn't re-nag you with it — it tucks the proposal into a collapsed
**"Previously rejected"** tray at the bottom of the Proposals tab. Nothing is ever silently
discarded: expand the tray and act on it if you change your mind.

**Event groups.** When one real event touches several pages, those proposals are boxed together so
you keep them consistent rather than meeting them as scattered edits.

#### 6.7 Triage tab — catching what the filter dropped

The **Triage** tab shows the mined facts in three buckets: **Canon** (used to build proposals),
**Uncertain**, and **Noise** (collapsed, with a count). The split is deliberately conservative. If
you spot a real fact that landed in Uncertain or Noise, **promote** it to Canon in one click and it
becomes available as a proposal.

---

## 7. Committing — writing it to the wiki

When you've approved everything you want, click **Commit … → jj** in the bottom bar. The app:

1. Writes each approved page's prose to `pkg/content/wiki/**` (amending or creating the page).
2. Records **provenance** — which wiki sentence came from which session and transcript lines — in a
   sidecar **outside** the wiki folder (`pkg/content/.heartwood/provenance/`). This keeps the
   wiki's rendered output unchanged and machine-traceable at once.
3. Creates **one** jj commit for the whole session, with an auto-generated message
   (e.g. `heartwood: through-a-song-darkly 2025-10-20 — 5 pages (3 amend, 2 create)`).

Guarantees worth knowing:

- **Nothing** is written until you press Commit. Approving alone changes no files.
- The commit is **path-scoped** — it touches only the pages it changed, leaving any unrelated
  working changes in the repo alone.
- It runs **jj**, never raw `git`.
- Committing is **idempotent**: re-committing won't double-write already-committed proposals.

> **One-time check before trusting it on the live wiki (recommended).** Because the wiki renders a
> live, byte-stable site, the very first time you commit for real it's worth confirming the wiki's
> build output only changed on the pages you touched (and the render engine + all other pages are
> byte-identical). This "aether build-diff" is the project's outstanding acceptance check.

After committing, you can keep reviewing more sessions, or stop the app with `Ctrl-C`.

---

## 8. Resuming a half-finished review

Just reopen the session. Every decision — approved, rejected (with its reason), deferred — and your
authored prose are saved per session, so you pick up exactly where you left off. Decisions live
under `pkg/heartwood/state/review/` (local, not committed to git).

---

## 9. The dashboard (coverage & slop)

From the session list, click **coverage & slop** (or visit `/dashboard`). It shows:

- **Slop rate** — the share of decided proposals you rejected for voice/quality (or rewrote away
  from an AI draft), measured from **your decisions**. This is the honest "how much did the tool
  waste my time" number. It should trend down over time.
- **Rejection reasons** — a tally of why you rejected things (tuning signal).
- **Coverage** — how many hand-labeled "should-have-been-captured" facts the pipeline actually
  found (recall), with precision and a false-canon rate. This table is populated by running the eval
  harness: `bun run --filter @faerrin/heartwood eval <arc> <date> --save`.

---

## 10. Where everything lives

| Thing                           | Location                             | Committed to git?            |
| ------------------------------- | ------------------------------------ | ---------------------------- |
| The wiki (your edits land here) | `pkg/content/wiki/`                  | yes                          |
| Transcripts (the source)        | `pkg/content/transcripts/`           | yes                          |
| Provenance sidecar              | `pkg/content/.heartwood/provenance/` | yes (outside `wiki/`)        |
| Ingested session artifacts      | `pkg/heartwood/state/sessions/`      | no (regenerate via `ingest`) |
| Your review decisions           | `pkg/heartwood/state/review/`        | no (local)                   |
| Rejection memory + quality log  | `pkg/heartwood/state/quality/`       | no (local)                   |

---

## 11. Troubleshooting

- **"No ingested sessions yet."** Run `ingest` (§6 ①), or `dev:fixture` for offline sample data.
- **"No transcript for &lt;arc&gt;@&lt;date&gt;."** Check the exact arc name and date against
  `ls pkg/content/transcripts/`. The arc is the name part, not the leading number.
- **`ingest` fails with a missing-key error.** You haven't set `ANTHROPIC_API_KEY` in
  `pkg/heartwood/.env` (§3).
- **"draft in voice" fails** with a key error. The _app_ also needs the key (§3, optional note).
  This affects only that button; reviewing and committing work without it.
- **Port 3001 already in use.** Stop whatever else is on 3001 (often a stray earlier `dev`), or
  change the port in `pkg/heartwood-review/vite.config.ts` (`server.port`).
- **Commit did nothing.** You have no _approved, uncommitted_ proposals — approve at least one, or
  they were already committed.
- **I rejected something and it vanished from the list.** It moved to the **Previously rejected**
  tray at the bottom of the Proposals tab (§6.6). Nothing is lost.

---

## 12. Command reference

Run from the **repo root**.

```sh
# Setup (once)
bun install
cp pkg/heartwood/.env.example pkg/heartwood/.env     # then add ANTHROPIC_API_KEY

# Offline demo
bun run --filter @faerrin/heartwood-review dev:fixture
bun run --filter @faerrin/heartwood-review dev        # → http://localhost:3001

# Real session
bun run --filter @faerrin/heartwood ingest <arc> <date>   # AI step, once per session
bun run --filter @faerrin/heartwood-review dev            # review + commit in the browser

# Quality numbers
bun run --filter @faerrin/heartwood eval <arc> <date> --save   # populate the coverage dashboard
```

---

## 13. Glossary

- **Arc** — a distinct campaign storyline (the named part of a transcript filename). The world's
  canon is _shared_ across arcs, so a fact in one arc can conflict with another.
- **Session** — one recorded transcript of one arc, identified by **(arc, date)**.
- **Claim / fact** — one atomic in-world fact mined from the transcript, with line citations and a
  _modality_ (canon vs guess vs in-character speech).
- **Proposal** — one reviewable unit: create a page, amend a page, or correct/retract a prior fact.
- **Provenance** — the machine-readable link from a wiki sentence back to the session + transcript
  lines that justify it, stored in a render-invisible sidecar.
- **Slop** — low-value or off-voice output you reject or rewrite; the dashboard measures its rate.

---

## 14. Going deeper

- **Why the tool is shaped this way:** `thoughts/heartwood/specs/0001-heartwood-rewrite-spec.md`.
- **Internals / developer notes:** [`CLAUDE.md`](./CLAUDE.md) (this package) and
  `pkg/heartwood/CLAUDE.md` (the pipeline).
- **Repo-wide conventions:** the root `CLAUDE.md`.
