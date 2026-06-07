// @faerrin/heartwood-pr — the GitHub-PR review surface for heartwood (NLSpec 0002).
//
// A local-first `gh`-polling bot (D-1) that opens one Pull Request per session, presents it
// story-first (recap → events → rendered prose), maps reviewer slash-commands onto the SHARED
// ledger (@faerrin/heartwood `state/review.ts`), re-drafts affected prose in voice, and canonizes
// on merge. It is an ALTERNATIVE surface to the local web app (@faerrin/heartwood-review), not a
// replacement (N1, D-9); the two share one decision ledger and a hard session lock (D-4).
//
// Architecture: pure machinery (command parsing, PR-body generation, markers, sanitizer-safe
// rendering) is decoupled from a thin `gh`/jj I/O shell so the core is fully unit-testable with no
// GitHub. See pkg/heartwood-pr/CLAUDE.md and thoughts/heartwood/specs/0002-*.md.

// Pure machinery (no GitHub, no jj) — the testable foundation. Modules are exported as they land.
export const PACKAGE = '@faerrin/heartwood-pr';
