# CLAUDE.md — `@faerrin/vellum`

The **Diegetic Document Forge**: write `remark`-directive markdown, see it rendered as PF2e
statblocks/handouts in the amber/teal 40k-gothic skin, export as PNG. See the spec at
`thoughts/vellum/specs/2026-06-09-vellum-diegetic-document-forge.md` (read it before large changes).

Built milestone-by-milestone; **M0–M6 are complete** — renderer library (`src/render/`), editor
SPA (`src/app/`), warm Playwright render service (`src/server/` + `scripts/render-server.ts`), the
full six-kind zoo + mechanical|diegetic theme axis, authoring polish (slash palette, template
gallery, share links, seeded grime), and deploy (`deploy/`). See `README.md` for run/deploy and the
spec for requirement IDs. Deferred slices: the full multi-document list (new/switch/rename/delete —
the rest of R-19) and golden-image visual-regression in Dagger CI with Chromium (NFR-9; `bun test`
is deliberately pure so CI stays green without a browser).

## Architecture (AD-4)

`src/render/` is a **pure, rules-illiterate library**: parse pipeline + presentational React
components. It **knows layout, never PF2e rules (R-9), never theme colors**. Colors come from
injected `@faerrin/gothic` tokens that the consuming app loads; this package only references the
CSS vars. The editor UI (later) is a separate, disposable consumer of this library.

- `parse.ts` — `parseDocument(source)`: markdown + directives → `VellumDocument`. Pure, total
  (never throws). Top-level `:::kind` container directives become blocks.
- `model.ts` — `VellumDocument` / `VellumBlock` / `DocumentKind` (the six-kind zoo) / `ThemeMode`.
- `mdastToReact.tsx` — total mdast → React renderer; unknown/malformed directives render an
  `ErrorChip`, never throw (R-4).
- `glyphs/actions.tsx` — inline-SVG action glyphs (AD-7: **not** an icon font; icon fonts blank
  out in PNG export). PF2e glyphs live here (vellum-local), **not** in `@faerrin/gothic` (OQ-5).
- `components/` — `Statblock`, `Handout`, and a `GenericBlock` fallback for the kinds without a
  bespoke layout yet (the parser already recognizes all six). `DocumentView` wraps blocks in the
  `[data-vellum-export]` boundary the render service will screenshot (R-15/R-18).

## Conventions

- **Bun everywhere** (`bun test`, `bun run typecheck`). No npm/node/npx.
- **Directive flavor, not a bespoke grammar** (AD-6): `:::statblock{…}[Label]`, inline `:action[2]`
  / `:trait[fire]`. Stays valid CommonMark so it degrades gracefully.
- **No raw hex in CSS** (NFR-3): colors only via `@faerrin/gothic` vars. (stylelint enforcement is
  a later add.)
- **Keep `src/render/` pure**: no DOM/`window`/`fs`, no rules math. DOM/IO belongs in the editor app.
