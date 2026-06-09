# CLAUDE.md — `@faerrin/gothic`

The shared gothic **skin**: design tokens (`tokens.css`), `@font-face` + font-family vars
(`fonts.css`), the font binaries (`fonts/`), and an `index.css` that imports both. Consumed by
`strider` and `vellum`.

## Rules

- **Keep it pure.** Tokens + fonts only. No React, no build step, no app/TTRPG logic. If you're
  tempted to add a component or a PF2e concept (action glyph, trait pill), it belongs in the
  consumer (`vellum`), not here. This boundary is a deliberate spec decision (vellum NLSpec, OQ-5).
- **No atmosphere.** strider's full-viewport scanline/vignette `body::before/::after` are
  canvas-coupled and stay in strider's `globals.css` — do not move them here.
- **Single source of truth.** These tokens/fonts must not be duplicated as literals in consumers.
  strider proves the extraction; changing a token here changes every consumer.
- **Two consumer contracts** (see README): consumers serve the binaries at `/fonts/`, and load
  IBM Plex Mono themselves via `@fontsource`.

## Gotchas

- `fonts.css` uses **absolute** `url("/fonts/…")` so it works for any consumer that serves the
  binaries at the site root. Don't switch to Vite-fingerprinted relative URLs without updating
  both consumers (it would also change strider's byte output).
- CSS-only package: there is nothing to typecheck/build/test here. Validation happens in the
  consumers (strider build must stay functionally identical; see the vellum spec NFR-4).
