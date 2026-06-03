# Session Intent Contract

**Created:** 2026-06-03
**Plan:** See .claude/session-plan.md
**Discovery:** thoughts/shared/research/2026-06-03-monorepo-migration-discovery.md

## Job Statement
Migrate four independently-developed apps (`pkg/{caster,heartwood,quartz,strider}`) into a single
**Bun-workspaces monorepo** so they can share resources/packages and a single source of truth for
the common Faerrin campaign data, without breaking the two live static sites (quartz, strider).

## Success Criteria
- All four apps build, typecheck, and test from a single root via `bun --filter`.
- One root `bun.lock`; shared dependency versions unified; no tracked secrets.
- quartz runs fully on Bun (off npm/tsx) with Astro + Vite + Pagefind validated.
- A clear, documented path to a single shared-content package (SSOT), with the drifted copies
  reconciled — executed as a gated phase 2.
- Nothing relies on the broken `update-transcripts.sh` cross-app sync.

## Boundaries / Constraints
- **jj repo** — every move/delete/rename uses `jj`, never raw git.
- **Only Claude is available** as a provider — all multi-LLM orchestration is fulfilled by distinct
  Claude persona agents (`octo:personas:*`), outputs synthesized by the lead. (See memory:
  octo-personas-not-llms.)
- **Live sites** — quartz (`heart.iridi.cc`) and strider are served by an external reverse proxy
  NOT in this repo. Output paths / basepaths must not change without explicit user confirmation.
- Per-app `CLAUDE.md` files conflict (caster forbids vite; strider/quartz use it) — keep nested.
- **Destructive data dedup** (deleting triplicated wiki/transcripts) requires a checkpoint before execution.

## Decisions (from intent capture)
- **Wiki ownership:** decide during implementation — scaffold the shared-content structure now,
  defer the ownership + reconciliation decision to a dedicated phase-2 step backed by a persona-agent
  analysis of both flows (heartwood-edits-quartz-publishes vs quartz-owns).
- **Scope:** foundation first. Phase 1 = steps 1–6 + 9. Phase 2 (gated) = shared-data SSOT (7) +
  `@faerrin/llm` extraction (8).
- **Involvement:** semi-autonomous — run low-risk steps autonomously; pause at high-risk gates
  (quartz→bun build validation; any destructive jj delete of duplicated data).

## Context
- Knowledge: well-informed (deep discovery just completed).
- Clarity: clear requirements (sequencing identified).
- Stakes: high (live sites + destructive data dedup).
