# Session Intent Contract — `@faerrin/mouth` (speaks → TypeScript)

**Created:** 2026-06-09
**Workflow:** /octo:plan (team mode — typescript-pro + backend-architect personas)

## Job Statement
Decide whether to rewrite the now-working `services/speaks` Rust Discord bot into a TypeScript
Bun-workspace package `@faerrin/mouth` under `pkg/`, and map the approach + risks if so.

## Captured Intent
- **Goal:** Research a topic — map the approach + risks before committing.
- **Knowledge:** Well-informed — knows discord.js/bun:sqlite; wants trade-offs + a port strategy.
- **Success:** Clear understanding + Working solution + Production-ready.
- **Constraints:** Must fit architecture (real `pkg/*` Bun member; `bun --filter` lanes; jj; wretch-style deploy).

## Success Criteria
1. A clear, honest "should we do this at all?" recommendation (the Rust bot already works).
2. If yes: a production-ready approach — roller parity-tested, CI fits bun lanes, Rust lane retired.
3. Either way: I know exactly what to do next (or what trigger would justify doing it).

## Boundaries
- Don't break the live bot or the green workspace.
- Roller behavior must match exactly (parity-gated).
- This is a PLAN only — no implementation.
