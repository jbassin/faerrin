---
name: transcript-arcs-and-naming
description: pkg/content/transcripts holds 6+ concurrent campaign arcs, not one linear session stream; the 000 arc's 30 transcripts share one basename and differ only by date
metadata:
  type: project
---

`pkg/content/transcripts/` is **not** a single linear campaign. As of 2026-06-06 it holds
41 transcripts across **at least 6 distinct arcs**, distinguished by a numeric prefix:
`000 through-a-song-darkly` (the big one, ~30 transcripts), `101 interred-in-iomenei`,
`102 fae-and-forest`, `103 a-hunt-of-metal-and-vine`, `104 the-first-spark`,
`105 observatory-slipped`, `106 fey-in-the-mists`.

**Naming gotcha:** every `000` transcript shares the **identical basename**
`000.through-a-song-darkly` and differs **only by the date** in the filename
(`000.through-a-song-darkly.2025-10-20.txt` … `2026-6-1.txt`). So a filename *stem* is
NOT a unique session ID — you need prefix + date.

Line IDs are zero-padded 6-digit, **per-file** (`000001`, `000002`, …), so a line citation
is only unique as `(transcript, lineId)`, never `lineId` alone. Transcripts are ~3,800 lines
/ ~230KB each. Format: `NNNNNN<TAB>Speaker: text  ` (speakers include `Gamemaster`,
player names like `Johnny`, `Argyle`).

**Why:** surfaced while reviewing the heartwood rewrite spec — the spec assumed "one
transcript = one session" on a single timeline, which the real data contradicts (arcs may be
parallel parties / different world-times; filename dates are recording dates, not world-time).

**How to apply:** any tool keying off `sessionId`, cross-session conflict detection, or a
"canon timeline" must account for the arc dimension and must not derive a unique ID from the
bare filename stem. See [[heartwood-rewrite-constraints]].
