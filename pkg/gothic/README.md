# @faerrin/gothic

The shared **amber/teal Warhammer-40k gothic skin** — design tokens + fonts — extracted from
`strider` so every gothic surface (strider, vellum, …) draws from one source and can't drift.

This package is a **pure, domain-agnostic skin**: CSS custom properties, `@font-face`
declarations, and the font binaries. It contains **no app logic, no React, and no TTRPG/PF2e
concepts** (action glyphs, trait pills, etc. live in their consuming package, e.g. `vellum`).
It deliberately **excludes** strider's canvas-coupled atmosphere (the full-viewport scanline
overlay and vignette `body::before/::after`) — those stay app-local.

## Usage

```ts
// Everything (fonts + tokens):
import "@faerrin/gothic/index.css";

// …or à la carte:
import "@faerrin/gothic/fonts.css";
import "@faerrin/gothic/tokens.css";
```

## Two consumer contracts (important)

1. **Serve the font binaries at `/fonts/`.** `fonts.css` references the faces by absolute URL
   (`url("/fonts/CaslonAntique.ttf")`, …). The canonical binaries live in this package under
   `fonts/`; each consumer must make them available at the site root `/fonts/` (e.g. copy into
   its `public/fonts/`). strider currently serves its own copies there.
2. **Load IBM Plex Mono yourself.** `--font-mono` names `"IBM Plex Mono"`, but this package does
   not bundle it (it's a `@fontsource/ibm-plex-mono` dependency the consumer imports). strider
   imports `@fontsource/ibm-plex-mono/400.css` + `/500.css`.

## Tokens

| Token | Value | Notes |
|-------|-------|-------|
| `--bg-void` | `#090c10` | base background |
| `--bg-panel` / `--bg-elevated` / `--bg-hover` | `#0f1318` / `#171c24` / `#1e2530` | surfaces |
| `--ink` / `--ink-dim` / `--ink-faint` | `#dce8f0` / `#7a8a99` / `#3a434f` | text |
| `--accent` | `#6dd5c0` | phosphor teal |
| `--accent-amber` | `#f0b46e` | amber |
| `--rule` / `--rule-bright` | `#1e2730` / `#2f3c4e` | hairlines |
| `--ease-out`, `--duration-fast/base/slow` | — | motion |
| `--font-display` / `--font-body` / `--font-mono` | ITC Serif Gothic / Caslon Antique / IBM Plex Mono | type |

## Fonts & licensing

ITC Serif Gothic is a commercial ITC face; Caslon Antique ships here too. The project holds a
license covering use and rasterizing/embedding into exported images (see the vellum spec, BLK-1).
Keep that in mind before redistributing the binaries outside this repo.
