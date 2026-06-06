---
name: heartwood-review-phase2-stage-a-d
description: heartwood-review Phase 2 Stages A-D shipped; server-fn I/O model + known security/portability gaps found in review
metadata:
  type: project
---

Phase 2 of the heartwood rewrite (the interactive review app, `pkg/heartwood-review`,
TanStack Start SSR + React 19) has Stages A-D committed on main as of 2026-06-06.
Server functions run under **Node, not Bun** (Vite SSR runtime) — core I/O was made
node:fs-portable for this. See [[heartwood-rewrite-progress]].

**Why:** spec §6/§11 review app replacing the retired PR pipeline; commits via jj, no PRs.

A team-mode `code-reviewer` pass on Stage A-D found three load-bearing gaps; **all are now
FIXED in Stage E** (kept here as the rationale for the guards, so they aren't regressed):
- **Path traversal → FIXED.** Server fns took user paths (`renderPagePreview`, `getTranscriptLines`,
  `getSession`) into `node:path.join` with no `..` guard. Added `within(root, rel)` in
  `src/server/content.ts` (resolve + `startsWith(root + sep)`), used by `readWikiPage` +
  `getTranscriptLines`; `getSession`/`saveDecision` validate `arc` (`/^[a-z0-9][a-z0-9-]*$/`) and
  `date` (`/^\d{4}-\d{2}-\d{2}$/`) before building the `${arc}@${date}.json` key. Tested in
  `content.test.ts`.
- **0.0.0.0 bind → FIXED.** Dropped `server.host=true` in `vite.config.ts`; loopback only.
- **Latent Bun-on-Node → FIXED.** Extracted the pure `parseFilename` into
  `pkg/heartwood/src/transcript/filename.ts`; `state/identity.ts` imports it (not `discover.ts`,
  which uses `Bun.Glob`/`Bun.file`). A Node-runtime guard test in `content.test.ts` imports
  `state/review.ts` + `identity.ts` and asserts they load + run without a Bun reference.
- Also from the review: `listSessions` no longer double-reads each artifact (`SessionSummary`
  now carries `proposalIds`); `writeFileAtomic` uses a unique tmp name; the Phase-0a spike
  route/server-fn were deleted (network surface). `execFile` for `jj` was confirmed safe.
