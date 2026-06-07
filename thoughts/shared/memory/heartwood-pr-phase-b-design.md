---
name: heartwood-pr-phase-b-design
description: Phase B (gh/jj I/O shell) design for the heartwood-pr bot — DI client interfaces, step decomposition, and the open decisions blocking implementation
metadata:
  type: project
---

Phase B of NLSpec 0002 (heartwood-pr bot) was DESIGNED 2026-06-06 (backend-architect pass). Phase A
pure core (`command/markers/render-safe/pr-body.ts`) + ledger delta are DONE on main. Phase B = the
DI'd gh/jj I/O shell, fake-tested, real run gated on the worldbuilder (Phase C). See the full design
in the spec/plan; key shape:

- **Two DI interfaces** `GhClient` (`src/gh.ts`) + `JjClient` (`src/jj.ts`), each method maps to one
  `gh`/`gh api`/`jj` argv via execFile (no shell). Reactions/comment-ids/PR-body-PATCH go through
  `gh api` (gh is 2.4.0). Page writes do NOT go through JjClient — they reuse performCommit/
  replacePageBody; JjClient is only branch/push/fetch/cleanup.
- **Steps as pure-over-IO fns**: openSession / pollOnce / redraftBatch / canonize, each taking BotDeps
  (gh, jj, ledger I/O, commit deps, draft fn, reviewerLogin, branchFor, now) so they're unit-testable
  against FakeGh/FakeJj/FakeLedger (no network, no LLM).
- **`/merge <note>` threading**: add ONE optional `instructions?` to DraftInput + a guarded buildUser
  block — additive, breaks no existing draft.ts caller.
- **Commit order (7)**: (1) DraftInput.instructions (2) GhClient+FakeGh (3) JjClient+FakeJj
  (4) openSession (5) pollOnce (6) redraftBatch (7) canonize+canonize-verify + thin bot.ts orchestrator.

**Why:** lets the bot's whole decision logic be asserted with zero GitHub/jj/LLM; the real
`gh pr create`/`jj git push`/aether-build are the autonomy boundary (worldbuilder-gated).

**How to apply:** when implementing Phase B, follow this commit order; keep steps fake-testable.
Three decisions are STILL OPEN and block clean implementation — see [[heartwood-pr-phase-b-open-decisions]].
Related: [[heartwood-pr-progress]], [[heartwood-pr-reuse-map]].
