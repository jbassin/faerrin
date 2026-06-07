---
name: heartwood-pr-phase-b-open-decisions
description: Three unresolved worldbuilder decisions that block clean heartwood-pr Phase B implementation (last-seen PR body storage, the new 763-file build guard, bot launch model)
metadata:
  type: project
---

Phase B design (2026-06-06) surfaced three decisions the worldbuilder must settle before/during
implementation — none are derivable from code:

1. **Where does `lastSeenPrBody` live?** `diffCheckboxState` (AC-26) needs the PREVIOUS PR body to
   detect an uncheck. Recommended: a NEW optional field on `PrLinkageSchema` (shared ledger) so it's
   durable across bot restarts. Alternative: a bot-local sidecar. Touches the shared ledger schema.

2. **The 763-file aether build+diff guard is NEW code, not a reuse.** Spec AC-21 + the plan both flag
   it as "still to be built." Scoped as `src/canonize-verify.ts` injected into `canonize` as
   `deps.verifyBuild` (fake in tests, real on host). Design posture: verify FAILURE blocks
   canonization (never set committedAt, never release the lock). Confirm the build command
   (`bun --filter @faerrin/aether build`) + where the 763-file baseline is recorded.

3. **Bot launch model + poll/batch intervals.** `bot.ts` orchestrator is intentionally un-unit-tested
   (autonomy boundary). Recommended: a one-shot `poll` CLI subcommand (idempotent, AC-13) on an
   external timer (cron/systemd) rather than a long-running daemon — a crash is then just a skipped
   tick. Poll interval + AC-12 redraft-batching window are operational knobs the worldbuilder owns.

Lesser flags: gh prCreate PR-number parsing (prefer a follow-up `gh pr list`); squash-only repo
config is a manual GitHub setting (canonizer keys off MERGED state regardless, for safety); a
`/defer`-then-merge race → canonize proceeds-but-flags (can't un-merge a remote merge).

**Why:** these are the genuinely ambiguous points; everything else in the design is concrete argv +
signatures ready to implement. **How to apply:** raise these with the worldbuilder before commit 1;
#1 gates the ledger schema, #2 gates canonize, #3 gates bot.ts. See [[heartwood-pr-phase-b-design]].
