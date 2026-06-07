# Heartwood PR — User Guide

A start-from-nothing guide to reviewing a Pathfinder 2e session **as a GitHub Pull Request** with
**Heartwood PR** (`@faerrin/heartwood-pr`).

This is the **async / mobile** way to review a session. It's a *peer* of the local web app
([`@faerrin/heartwood-review`](../heartwood-review/GUIDE.md)) — same decisions, same wiki, same
provenance — just reached through a GitHub PR instead of a desktop browser tab. For the _why_ behind
the design see the spec (`thoughts/heartwood/specs/0002-heartwood-pr-interface-spec.md`); for
developer internals see [`CLAUDE.md`](./CLAUDE.md). This guide is about _using_ it.

> ⚠️ **Status: not yet end-to-end.** The whole decision engine is built and tested, and the bot can
> open/poll/re-draft a real PR. **Two things are still gated** and must be wired/validated on your
> machine before a full open→merge→canonize round-trip works: the **merge build-guard** (`verifyBuild`,
> AC-21) and the **fidelity surfaces** (the sanitizer spike + the deploy-preview host). See §7. Until
> then, treat this as a **read/triage** surface, not a merge-to-canon surface.

---

## 1. What this is (in one minute)

After a session is ingested (the same `ingest` step the web app uses), Heartwood PR opens **one
Pull Request per session**. The PR reads **story-first**:

- a **header** with counts, then an in-voice **recap** of what the session revealed;
- the session's **events**, each expanding to the wiki pages it touched, every page showing its
  proposed prose **rendered** (not a `+/-` diff);
- clean edits as **pre-checked checkboxes** — you only uncheck the ones that are wrong (review by
  subtraction);
- canon **conflicts** as top-level comments you resolve with terse slash-commands.

**The branch is the draft; merging is the act of authorship.** Nothing reaches the live wiki until
*you* merge. A local **bot** does the mechanical work (drafting prose, applying your commands,
pushing to the branch); it **never merges** — that's always your click.

This deliberately avoids the three failures that killed the original PR tool: one event-grouped PR
(not ~37 micro-proposals), prose judged **rendered** (not as diffs), and a coherent **recap** (not a
pile of file changes).

---

## 2. Prerequisites

You need, once:

- **[Bun](https://bun.sh)** and **[jj](https://github.com/jj-vcs/jj)** (this repo is Jujutsu, not
  git — the bot pushes the session branch with `jj git push`, never raw git).
- The **GitHub CLI** `gh`, authenticated: `gh auth login` (the bot talks to GitHub through it).
- A **GitHub remote** on the repo (this repo: `github.com:jbassin/faerrin`).
- `ANTHROPIC_API_KEY` in `pkg/heartwood/.env` (the bot drafts prose via the core's `complete()`).
- Install once from the repo root: `bun install`.

Two environment values the bot reads:

| Variable | What | Example |
|---|---|---|
| `HEARTWOOD_REVIEWER_LOGIN` | **Your GitHub login** — the *only* account whose commands the bot obeys (everything else is ignored). | `josh` |
| `ANTHROPIC_API_KEY` | For in-voice drafting. | `sk-ant-…` |

**Recommended GitHub repo setting:** turn on **Allow squash merging** and turn *off* merge-commit /
rebase merges. The canonizer expects a squash merge (one commit per session — see the spec's
"D-15 RESOLVED"); squash-only means you can't accidentally pick a history-smearing merge.

---

## 3. The one-time mental model

```
ingest a session ─▶ bot opens a PR ─▶ you review on GitHub ─▶ you merge ─▶ bot canonizes locally
  (LLM pipeline)     (branch+body)     (uncheck / commands)    (your click)   (build + committedAt)
```

- **One PR per session.** Its identity is `(arc, date)` — e.g. `through-a-song-darkly` @
  `2025-08-28`. The branch is the jj bookmark `hw/<arc>-<date>`.
- **One ledger, one surface.** While a session's PR is open, the **web app is read-only** for that
  session (and vice-versa). You review a session in *one* place at a time.
- **The bot polls.** It's a one-shot command you run on a timer (cron/systemd) — see §6. Each run is
  idempotent; a missed/crashed run is just a skipped tick.

---

## 4. Reviewing a session (the happy path)

### Step 0 — ingest (once per session)

Same as the web app:

```sh
bun run --filter @faerrin/heartwood ingest <arc> <date>
# e.g.
bun run --filter @faerrin/heartwood ingest through-a-song-darkly 2025-08-28
```

This runs the LLM pipeline and persists a **SessionArtifact** (proposals + recap + conflicts).

### Step 1 — open the PR

```sh
cd pkg/heartwood-pr
HEARTWOOD_REVIEWER_LOGIN=<your-gh-login> bun run bot open <arc> <date>
```

The bot drafts each page in voice, pushes the `hw/<arc>-<date>` branch, opens the PR, and posts a
comment for each canon conflict. Open the PR on github.com or the GitHub mobile app.

### Step 2 — review on GitHub

- **Read the recap, then the events.** Each event expands to its pages with the proposed prose.
- **Reject a page** by **unchecking** its box. (You don't need to do anything for the good ones —
  they're pre-checked.)
- **Resolve a conflict** by replying to its comment with **one** slash-command:

  | Command | Effect |
  |---|---|
  | `/keep` | Keep the existing canon; drop the session's contradicting fact. |
  | `/replace` | Take the new fact; the page is re-drafted as a correction. |
  | `/merge <note>` | Take the new fact, re-drafted **conditioned on your note** (e.g. `/merge use the older spelling`). |
  | `/defer` | Leave it unresolved for now. **Blocks merge** — resolve it later in the web app after closing the PR. |

  > **Tip:** use GitHub's **"Quote reply"** on the conflict comment so your reply carries the hidden
  > marker that binds your command to the right page. The bot reacts 👀 when it picks your command up
  > and 🚀 when it's applied.

### Step 3 — the bot reacts

On its next poll the bot records your commands/unchecks in the shared ledger and, for any conflict
you accepted, **re-drafts** the affected page in voice and pushes it to the branch. If a re-draft
changes a page you'd already approved, it **auto-unchecks** it and flags *"re-read — this changed"*
so nothing approved mutates silently. If you hand-edited a page on the branch, the bot **leaves it
alone**.

### Step 4 — merge (the authorship act)

When the PR reads right, **merge it** (squash). That's the only path to canon — the bot never merges
for you. On its next run the bot **canonizes locally**: confirms the prose + provenance landed on
`main`, stamps the commit time, releases the session lock, and runs the build guard.

> A `/defer`red conflict **blocks merge** by design — clear it (`/keep`/`/replace`) or close the PR
> and resolve it in the workbench first.

---

## 5. Escape hatches

- **Bad draft?** Edit the page right in GitHub's **Files** tab, or open it in the web app
  ("workbench") — one tap, no command needed. The bot won't clobber your edit.
- **Changed your mind on a command?** Just reply again with a different one — last write wins.
- **Close without merging?** Nothing reaches the wiki; the session unlocks and can be re-opened in
  either surface.

---

## 6. Running the bot on a timer

The bot is **one-shot** by design (no daemon to wedge). Point cron/systemd at a single `tick`:

```sh
# every 2 minutes, per open session
cd /path/to/repo/pkg/heartwood-pr
HEARTWOOD_REVIEWER_LOGIN=<your-gh-login> bun run bot tick <arc> <date>
```

`tick` = poll your commands/checkboxes → re-draft any affected pages → try to canonize (a no-op
until you merge). Each tick is idempotent, so over-running it is harmless.

Subcommands:

| `bun run bot …` | Does |
|---|---|
| `open <arc> <date>` | Open the session PR (once). |
| `poll <arc> <date>` | Apply new commands + checkbox edits. |
| `tick <arc> <date>` | poll → re-draft → canonize (the cron entry). |
| `canonize <arc> <date>` | Detect a merge + canonize locally. |

---

## 7. What's not wired yet (read before a real merge)

Three pieces are intentionally **gated** — the engine is built and tested, but they touch your host
and must be validated by you:

1. **The merge build-guard (`verifyBuild`, AC-21).** Canonization runs the aether build and checks
   that *only* this session's pages changed (the 763-file byte-stability guard). The last piece —
   mapping a wiki page to its built output path (aether's slug logic) — must be confirmed on your
   host. Until it is, **`canonize` throws at the build guard**, so don't merge-and-expect-canon yet.
2. **The sanitizer spike (R7).** GitHub strips aether's HTML, so the PR body shows a
   *sanitizer-safe* rendering and the **faithful** read is meant to be a per-page **deploy-preview**.
   That representation is built and self-checked, but should be confirmed against GitHub's live
   sanitizer before you trust in-body prose for fidelity.
3. **The deploy-preview host (AC-18).** A per-branch aether build + preview host (the faithful
   mobile read) isn't stood up yet.

Until #1–#3 are done, use the PR surface to **read and triage** a session and to drive the
re-drafts, but do the actual **canonization** through the web app, or wait for the guard wiring.

---

## 8. Troubleshooting

- **"set HEARTWOOD_REVIEWER_LOGIN"** — export your GitHub login (§2).
- **"session … not ingested"** — run the `ingest` step (§4 Step 0) first.
- **"locked by the web app"** — that session is open in the workbench; close it there first (one
  surface at a time).
- **"a PR is already open for hw/…"** — there's already a session PR; don't open a second.
- **A command did nothing** — check it came from `HEARTWOOD_REVIEWER_LOGIN`, that you quote-replied
  on the *conflict comment* (so the marker is included), and that it's one of the four commands.
- **`verifyBuild.expectedChanged … gated`** — that's #1 in §7; expected until the build-guard map is
  wired on your host.
