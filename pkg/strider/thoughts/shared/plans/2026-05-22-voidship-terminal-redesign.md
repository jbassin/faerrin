# Voidship Terminal Redesign

## Overview

Full visual redesign of the Strider faction map site in a "Voidship Terminal" aesthetic: near-black void background, `Big Shoulders Display` for heads, `IBM Plex Mono` for chrome/labels, `IBM Plex Sans` for body prose, faction colors glowing against the dark, and HUD-style modal panels with corner brackets. This covers every rendered surface: home page, hex map, modal, faction detail component, and the mobile faction page.

## Current State Analysis

- **globals.css** (`src/app/globals.css:1-7`): only a box-sizing reset. No colors, no fonts, no background.
- **layout.tsx** (`src/app/layout.tsx`): no font imports; `<html>` and `<body>` completely plain.
- **MapView** (`src/components/MapView/MapView.module.css`): 6-line file — just centering and max-width.
- **HexMap** (`src/components/HexMap/HexMap.tsx`): hardcoded neutral color `#6b7280`; strokes `#00000020`/`#00000015`. No custom-property glow, no dark-scheme treatment.
- **Modal** (`src/components/Modal/Modal.module.css`): `white` background card, plain `border-radius: 0.5rem`, `rgba(0,0,0,0.5)` backdrop. No brand identity.
- **FactionDetail** (`src/components/FactionDetail/FactionDetail.module.css`): plain centered name, bare `<h2>`, initials in a circle, no typography hierarchy.
- **Faction page** (`src/app/factions/[slug]/page.tsx`): raw `<Link href="/">← Back</Link>`, no styles, no Chrome.
- **E2E selectors to preserve** (`e2e/faction-flow.spec.ts`): `svg`, `polygon`, `[role="dialog"]`, `[data-testid="modal-backdrop"]`, `h2` inside dialog, faction page `h2`, back link navigating to `/`.

## Desired End State

After this plan the site renders as a styled terminal interface:

- Dark void background (`#090c10`) with a subtle scanline overlay across the whole viewport.
- Full-width header bar: `▌STRIDER//FACTIONS▐` on the left (display + mono mix), `ENTITIES: 20 ◈ ACTIVE` on the right. Terminal chrome aesthetic.
- Hex map framed in a thin panel border. Faction hexes glow on hover with their own color. Neutral hexes recede into the dark.
- Modal as a dark HUD card: faction color-band at the top, corner brackets in phosphor teal (`#6dd5c0`), close button, `// OVERVIEW` / `// PERSONNEL` section labels in mono.
- FactionDetail: `// 07` order prefix in mono, faction name in display type at 1.6rem/900 weight, hex-shaped symbol placeholder, member names in display small-caps, prose in `IBM Plex Sans` at `var(--ink-dim)`.
- Mobile faction page has the same card framing plus a styled `← RETURN TO MAP` back link.
- All motion respects `prefers-reduced-motion`.

Verification: `bun run lint`, `bun run typecheck`, `bun run build` all pass. `bun run test:e2e` passes (selectors preserved).

### Key Discoveries

- `next/font/google` with `variable` option works under `output: 'export'` — fonts are downloaded at build time and served statically. Safe to use.
- `cellStyle` on `react-hexgrid`'s `<Hexagon>` maps to the SVG `<polygon>` element's `style` attribute. CSS custom properties can be injected here (cast as `React.CSSProperties`), enabling per-polygon `--faction-color` for CSS `filter: drop-shadow(...)`.
- E2E tests use `dialog.locator('h2')` for the faction name — the `<h2>` in FactionDetail must stay.
- The back link on the mobile faction page must have `href="/"` (test navigates back to `/`).
- Modal z-index is currently 100; scanlines overlay will use z-index 9999 with `pointer-events: none` so it doesn't block interaction.
- FactionDetail is shared between Modal (desktop) and `/factions/[slug]` (mobile). Setting `--faction-color` on the FactionDetail root div (via `style`) covers both cases without prop-drilling.
- Modal card also needs `--faction-color` on its own div for the top border-color.

## What We're NOT Doing

- No changes to `src/lib/` (data loading, hex math, hooks) — logic is untouched.
- No changes to `content/factions/*.md` content.
- No changes to the `react-hexgrid` layout parameters (viewBox, size, spacing) — covered in a separate plan.
- No new runtime dependencies beyond `next/font/google` (already part of Next.js).
- No custom cursor, parallax, or canvas effects.
- No per-polygon entrance animation stagger (would require attaching animation-delay to 3000+ SVG polygons; deferred to a future polish pass).

---

## Implementation Approach

Work surface-by-surface, inside-out: tokens first, then structural chrome, then the interactive pieces (hex map, modal, detail, page). Each phase is independent and ship-safe.

---

## Phase 1 — Design Tokens, Fonts, Global Atmosphere

### Overview

Establish the full design system: three font families via `next/font`, CSS custom properties on `:root`, dark body base styles, and a scanline + vignette overlay.

### Changes Required

#### 1. Font imports and HTML class

**File**: `src/app/layout.tsx`

Replace the current layout with:

```tsx
import type { Metadata } from "next";
import {
  Big_Shoulders_Display,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
} from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader/SiteHeader";

const display = Big_Shoulders_Display({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-display",
  display: "swap",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Strider",
  description: "Faction map of The Strider",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body suppressHydrationWarning>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
```

(SiteHeader is added here because it's in every page. Created in Phase 2.)

#### 2. Global CSS design system

**File**: `src/app/globals.css`

Full replacement:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  /* Type — populated by next/font via className on <html> */
  --font-display: var(--font-display, serif);
  --font-body: var(--font-body, sans-serif);
  --font-mono: var(--font-mono, monospace);

  /* Void palette */
  --bg-void: #090c10;
  --bg-panel: #0f1318;
  --bg-elevated: #171c24;
  --bg-hover: #1e2530;

  --ink: #dce8f0;
  --ink-dim: #7a8a99;
  --ink-faint: #3a434f;

  --accent: #6dd5c0; /* phosphor teal */
  --accent-amber: #f0b46e;

  --rule: #1e2730;
  --rule-bright: #2f3c4e;

  /* Motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast: 120ms;
  --duration-base: 220ms;
  --duration-slow: 400ms;
}

html,
body {
  height: 100%;
}

body {
  display: flex;
  flex-direction: column;
  background-color: var(--bg-void);
  color: var(--ink);
  font-family: var(--font-body), sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

main {
  flex: 1;
}

/* Scanline overlay — decorative, non-interactive */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 3px,
    rgba(0, 0, 0, 0.06) 3px,
    rgba(0, 0, 0, 0.06) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

/* Vignette — draws the eye to the map center */
body::after {
  content: "";
  position: fixed;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    transparent 50%,
    rgba(0, 0, 0, 0.45) 100%
  );
  pointer-events: none;
  z-index: 9998;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

### Success Criteria

#### Automated Verification

- [x] Type-checks: `bun run typecheck`
- [x] Lints: `bun run lint`
- [x] Builds: `bun run build` (fonts downloaded, no CSS errors)

#### Manual Verification

- [ ] `bun dev` — page background is near-black, not white
- [ ] Scanline texture is faintly visible at normal viewing distance
- [ ] Vignette darkens edges without being distracting

---

## Phase 2 — Page Chrome (SiteHeader + MapView Status Bar)

### Overview

Add a full-width terminal-style header to every page, and a query/status line beneath the hex map on the home screen.

### Changes Required

#### 1. SiteHeader component

**File**: `src/components/SiteHeader/SiteHeader.tsx` _(new)_

```tsx
import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
  return (
    <header className={styles.root}>
      <span className={styles.brand}>
        <span className={styles.bracket}>▌</span>
        <span className={styles.brandName}>STRIDER</span>
        <span className={styles.slash}>//</span>
        <span className={styles.brandSub}>FACTIONS</span>
        <span className={styles.bracket}>▐</span>
      </span>
      <span className={styles.meta}>
        ENTITIES<span className={styles.sep}> : </span>
        <span className={styles.metaVal}>20</span>
        <span className={styles.dot}>◈</span>
        ACTIVE
      </span>
    </header>
  );
}
```

**File**: `src/components/SiteHeader/SiteHeader.module.css` _(new)_

```css
.root {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  height: 44px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--rule-bright);
  font-family: var(--font-mono), monospace;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  color: var(--ink-dim);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0;
  color: var(--ink);
  font-size: 0.82rem;
}

.brandName {
  font-family: var(--font-display), serif;
  font-weight: 900;
  font-size: 1.05rem;
  letter-spacing: 0.15em;
}

.brandSub {
  letter-spacing: 0.1em;
}

.bracket {
  color: var(--accent);
  font-size: 0.9rem;
}

.slash {
  color: var(--accent);
  margin: 0 0.05em;
}

.meta {
  display: none;
}

.sep {
  color: var(--ink-faint);
}

.metaVal {
  color: var(--ink);
}

.dot {
  color: var(--accent);
  margin: 0 0.5em;
}

@media (min-width: 480px) {
  .meta {
    display: inline;
  }
}
```

#### 2. MapView — add frame + status line

**File**: `src/components/MapView/MapView.tsx`

Add a `selectedFaction`-driven status string and a `.frame` wrapper div:

```tsx
return (
  <div className={styles.root}>
    <div className={styles.frame}>
      <HexMap factions={factions} onFactionClick={handleFactionClick} />
    </div>
    <div className={styles.status}>
      {selectedFaction
        ? `// ENTITY: ${selectedFaction.name.toUpperCase()}`
        : "// SELECT ENTITY TO QUERY"}
    </div>
    <Modal faction={selectedFaction} onClose={() => setSelectedFaction(null)} />
  </div>
);
```

**File**: `src/components/MapView/MapView.module.css`

```css
.root {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.25rem 1rem 1rem;
  gap: 0;
}

.frame {
  width: 100%;
  max-width: 680px;
  background: var(--bg-panel);
  border: 1px solid var(--rule-bright);
  padding: 0.5rem;
}

.status {
  width: 100%;
  max-width: 680px;
  padding: 0.35rem 0.6rem;
  background: var(--bg-panel);
  border: 1px solid var(--rule);
  border-top: none;
  font-family: var(--font-mono), monospace;
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  color: var(--accent);
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck`
- [x] `bun run lint`

#### Manual Verification

- [ ] Header bar visible at top of page with correct terminal text
- [ ] Map is wrapped in a dark panel frame
- [ ] Status bar shows "SELECT ENTITY TO QUERY" on load, updates when a hex is clicked (desktop)
- [ ] No layout breakage on mobile (<480px)

---

## Phase 3 — HexMap Visual Upgrade

### Overview

Dark-scheme neutral hexes, faction-color glow on hover, cleaner strokes, and subtle inner glow filter for faction territory fills.

### Changes Required

#### 1. HexMap.tsx — dark neutral color, faction glow via CSS custom property

**File**: `src/components/HexMap/HexMap.tsx`

Change `NEUTRAL_COLOR`:

```ts
const NEUTRAL_COLOR = "#141a22";
```

Update faction hex `cellStyle` to inject `--faction-color`:

```tsx
cellStyle={{
  fill: faction.color,
  stroke: '#090c10',
  strokeWidth: '0.2',
  '--faction-color': faction.color,
} as React.CSSProperties}
```

Update neutral hex `cellStyle`:

```tsx
cellStyle={{
  fill: NEUTRAL_COLOR,
  stroke: '#090c10',
  strokeWidth: '0.1',
}}
```

#### 2. HexMap.module.css — glow hover, dark root

**File**: `src/components/HexMap/HexMap.module.css`

```css
.root {
  width: 100%;
  aspect-ratio: 7 / 8;
  background: var(--bg-void);
}

.factionHex {
  cursor: pointer;
  transition: filter var(--duration-fast) var(--ease-out);
}

.factionHex:hover {
  filter: drop-shadow(0 0 2px var(--faction-color))
    drop-shadow(0 0 6px var(--faction-color));
}

.neutralHex {
  cursor: default;
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck` (the `as React.CSSProperties` cast is required)
- [x] `bun run lint`
- [x] `bun run test` (hex assignment tests still pass)

#### Manual Verification

- [ ] Faction hexes are fully colored against the dark background
- [ ] Neutral hexes are a dark receding color, not mid-gray
- [ ] Hovering a faction hex produces a visible color-matched glow
- [ ] Dark gaps between hexes are clean (no bleed)

---

## Phase 4 — Modal as HUD Panel

### Overview

Restyle the modal card as a dark HUD panel: faction color-band at the top border, phosphor-teal corner brackets via CSS `::before`/`::after`, backdrop-filter blur, and a styled close button. All existing ARIA attributes and `data-testid` values are preserved.

### Changes Required

#### 1. Modal.tsx — inject faction color, add close button

**File**: `src/components/Modal/Modal.tsx`

Add `--faction-color` to the card div's style, add a close button:

```tsx
<div
  ref={cardRef}
  className={styles.card}
  style={{ "--faction-color": faction.color } as React.CSSProperties}
  onClick={(e) => e.stopPropagation()}
  role="dialog"
  aria-modal="true"
  aria-label={`${faction.name} details`}
  tabIndex={-1}
>
  <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
    ✕
  </button>
  <FactionDetail faction={faction} />
</div>
```

Bump the backdrop z-index to sit above scanlines' siblings (1000 > 100):

- Update `z-index` in `.backdrop` to `1000`.

#### 2. Modal.module.css — HUD panel styling

**File**: `src/components/Modal/Modal.module.css`

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(9, 12, 16, 0.8);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.card {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--rule-bright);
  border-top: 3px solid var(--faction-color, var(--accent));
  max-width: 560px;
  width: calc(100% - 2rem);
  max-height: 85vh;
  overflow-y: auto;
  outline: none;
}

/* Top-left bracket */
.card::before {
  content: "";
  position: absolute;
  top: 6px;
  left: 6px;
  width: 12px;
  height: 12px;
  border-top: 1px solid var(--accent);
  border-left: 1px solid var(--accent);
  pointer-events: none;
}

/* Bottom-right bracket */
.card::after {
  content: "";
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 12px;
  height: 12px;
  border-bottom: 1px solid var(--accent);
  border-right: 1px solid var(--accent);
  pointer-events: none;
}

.closeBtn {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  background: transparent;
  border: 1px solid var(--rule-bright);
  color: var(--ink-dim);
  font-family: var(--font-mono), monospace;
  font-size: 0.75rem;
  padding: 0.15rem 0.45rem;
  cursor: pointer;
  line-height: 1;
  transition:
    color var(--duration-fast),
    border-color var(--duration-fast);
  z-index: 1;
}

.closeBtn:hover {
  color: var(--ink);
  border-color: var(--ink-faint);
}

.closeBtn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 2px;
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck`
- [x] `bun run lint`
- [ ] `bun run test:e2e` — all modal tests pass (`[role="dialog"]`, `[data-testid="modal-backdrop"]`, `h2` visible, Escape closes, backdrop click closes)

#### Manual Verification

- [ ] Modal card background is dark, not white
- [ ] Faction color-band visible at card top (verify with several factions — each color distinct)
- [ ] Corner brackets visible in phosphor teal
- [ ] Close button (✕) visible, clickable, closes modal
- [ ] Backdrop has a visible blur effect behind the card

---

## Phase 5 — FactionDetail Redesign

### Overview

Restructure FactionDetail's markup and styles for the HUD aesthetic: `// 07` order prefix, display-weight faction name, hex-shaped symbol placeholder, `// OVERVIEW` / `// PERSONNEL` section labels, member names in display type. The `<h2>` for the faction name is preserved (required by e2e).

### Changes Required

#### 1. FactionDetail.tsx — restructured markup

**File**: `src/components/FactionDetail/FactionDetail.tsx`

```tsx
import Image from "next/image";
import type { Faction } from "@/lib/factions";
import styles from "./FactionDetail.module.css";

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

interface FactionDetailProps {
  faction: Faction;
}

export default function FactionDetail({ faction }: FactionDetailProps) {
  return (
    <div
      className={styles.root}
      style={{ "--faction-color": faction.color } as React.CSSProperties}
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.orderId}>
            // {String(faction.order).padStart(2, "0")}
          </span>
          <h2 className={styles.name}>{faction.name.toUpperCase()}</h2>
        </div>
        <div className={styles.symbol}>
          {faction.symbol ? (
            <Image
              src={`/${faction.symbol}`}
              alt={`${faction.name} symbol`}
              width={64}
              height={64}
            />
          ) : (
            <div
              className={styles.symbolPlaceholder}
              style={{ background: faction.color }}
              aria-label={`${faction.name} symbol placeholder`}
            >
              {initials(faction.name)}
            </div>
          )}
        </div>
      </div>

      <div className={styles.divider} />

      {faction.description && (
        <section className={styles.section}>
          <h3 className={styles.sectionLabel}>// OVERVIEW</h3>
          <div
            className={styles.description}
            dangerouslySetInnerHTML={{ __html: faction.description }}
          />
        </section>
      )}

      {faction.members.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionLabel}>// PERSONNEL</h3>
          {faction.members.map((member) => (
            <div key={member.name} className={styles.member}>
              <h4 className={styles.memberName}>{member.name.toUpperCase()}</h4>
              <div
                className={styles.memberBio}
                dangerouslySetInnerHTML={{ __html: member.bio }}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
```

#### 2. FactionDetail.module.css — full replacement

**File**: `src/components/FactionDetail/FactionDetail.module.css`

```css
.root {
  padding: 1.25rem 1.5rem 1.5rem;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  padding-top: 0.25rem; /* space below close button */
}

.headerLeft {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.orderId {
  font-family: var(--font-mono), monospace;
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  color: var(--accent);
}

.name {
  font-family: var(--font-display), serif;
  font-size: 1.55rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: var(--ink);
  line-height: 1.1;
  text-align: left;
  margin: 0;
  word-break: break-word;
}

.symbol {
  flex-shrink: 0;
}

.symbol img {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

.symbolPlaceholder {
  width: 64px;
  height: 64px;
  /* Point-top hexagon */
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-family: var(--font-display), serif;
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.divider {
  height: 1px;
  background: var(--faction-color, var(--rule-bright));
  margin-bottom: 1.25rem;
  opacity: 0.6;
}

.section {
  margin-bottom: 1.25rem;
}

.section:last-child {
  margin-bottom: 0;
}

.sectionLabel {
  font-family: var(--font-mono), monospace;
  font-size: 0.63rem;
  letter-spacing: 0.18em;
  color: var(--accent);
  margin-bottom: 0.6rem;
  font-weight: 400;
}

.description {
  font-family: var(--font-body), sans-serif;
  font-size: 0.875rem;
  line-height: 1.65;
  color: var(--ink-dim);
}

.description p {
  margin-bottom: 0.7rem;
}

.description p:last-child {
  margin-bottom: 0;
}

.member {
  margin-bottom: 1rem;
  padding-left: 0.75rem;
  border-left: 2px solid var(--rule-bright);
}

.member:last-child {
  margin-bottom: 0;
}

.memberName {
  font-family: var(--font-display), serif;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink);
  margin-bottom: 0.4rem;
}

.memberBio {
  font-family: var(--font-body), sans-serif;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--ink-dim);
}

.memberBio p {
  margin-bottom: 0.5rem;
}

.memberBio p:last-child {
  margin-bottom: 0;
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck`
- [x] `bun run lint`
- [ ] `bun run test:e2e` — `dialog.locator('h2')` still resolves and is visible; mobile `page.locator('h2')` visible

#### Manual Verification

- [ ] `// 07` order prefix appears in phosphor teal mono above the faction name
- [ ] Faction name in display-weight large type, left-aligned
- [ ] Symbol placeholder is hex-shaped (not circular), faction-colored
- [ ] `// OVERVIEW` and `// PERSONNEL` labels in small mono
- [ ] Member names in display type, larger than body prose
- [ ] Prose in dim ink, legible on dark background

---

## Phase 6 — Faction Page Chrome (Mobile Route)

### Overview

The `/factions/[slug]` page needs consistent chrome with the home page: the header is already there from layout.tsx. This phase adds a styled back link and a card wrapper around FactionDetail.

### Changes Required

#### 1. Faction page — card wrapper + styled back link

**File**: `src/app/factions/[slug]/page.tsx`

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllFactions, getFactionBySlug } from "@/lib/factions";
import FactionDetail from "@/components/FactionDetail/FactionDetail";
import styles from "./page.module.css";

export async function generateStaticParams() {
  const factions = await getAllFactions();
  return factions.map((f) => ({ slug: f.slug }));
}

export default async function FactionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const faction = await getFactionBySlug(slug);
  if (!faction) notFound();

  return (
    <main className={styles.root}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.back}>
          <span className={styles.arrow}>←</span> RETURN TO MAP
        </Link>
        <span className={styles.breadcrumb}>
          // {String(faction.order).padStart(2, "0")}{" "}
          {faction.name.toUpperCase()}
        </span>
      </nav>
      <div
        className={styles.card}
        style={{ "--faction-color": faction.color } as React.CSSProperties}
      >
        <FactionDetail faction={faction} />
      </div>
    </main>
  );
}
```

#### 2. Faction page CSS

**File**: `src/app/factions/[slug]/page.module.css` _(new)_

```css
.root {
  padding: 1rem;
  max-width: 620px;
  margin: 0 auto;
}

.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--rule);
  gap: 1rem;
  overflow: hidden;
}

.back {
  font-family: var(--font-mono), monospace;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  color: var(--accent);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.4em;
  flex-shrink: 0;
  transition: color var(--duration-fast);
}

.back:hover {
  color: var(--ink);
}

.arrow {
  font-size: 0.9em;
}

.breadcrumb {
  font-family: var(--font-mono), monospace;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card {
  background: var(--bg-elevated);
  border: 1px solid var(--rule-bright);
  border-top: 3px solid var(--faction-color, var(--accent));
}
```

Note: the `back` link's `href="/"` is preserved for the e2e test that confirms navigation back to `/`.

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run build`
- [ ] `bun run test:e2e` — mobile back button test navigates to `/`

#### Manual Verification

- [ ] `← RETURN TO MAP` link visible, styled in accent color
- [ ] Faction card has color-band at top matching faction color
- [ ] Breadcrumb in mono faint color on the right
- [ ] Consistent with home page header

---

## Phase 7 — Motion + Reduced-Motion Polish

### Overview

High-impact entrance animations and hover micro-interactions. All motion is opt-in via CSS animations with `prefers-reduced-motion` already guarded globally in globals.css (Phase 1).

### Changes Required

#### 1. SiteHeader entrance

**File**: `src/components/SiteHeader/SiteHeader.module.css`

Add:

```css
@keyframes slideDown {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.root {
  /* existing styles… */
  animation: slideDown var(--duration-slow) var(--ease-out) both;
}
```

#### 2. MapView frame + status entrance

**File**: `src/components/MapView/MapView.module.css`

Add:

```css
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.frame {
  /* existing styles… */
  animation: fadeIn var(--duration-slow) var(--ease-out) 0.15s both;
}

.status {
  /* existing styles… */
  animation: fadeIn var(--duration-slow) var(--ease-out) 0.25s both;
}
```

#### 3. HexMap entrance

**File**: `src/components/HexMap/HexMap.module.css`

```css
@keyframes hexReveal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.factionHex {
  /* existing styles… */
  animation: hexReveal var(--duration-slow) var(--ease-out) 0.3s both;
}

.neutralHex {
  animation: hexReveal var(--duration-slow) var(--ease-out) 0.35s both;
}
```

#### 4. Modal entrance

**File**: `src/components/Modal/Modal.module.css`

```css
@keyframes backdropIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes cardRise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.backdrop {
  /* existing styles… */
  animation: backdropIn var(--duration-base) var(--ease-out) both;
}

.card {
  /* existing styles… */
  animation: cardRise var(--duration-base) var(--ease-out) both;
}
```

Note: exit animation is not implemented — the card unmounts immediately when `faction` becomes null. An exit animation would require keeping the component mounted during a transition; this is a follow-up if needed.

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run build`
- [ ] `bun run test:e2e` (animations don't break any selectors or timing)

#### Manual Verification

- [ ] Header slides down on page load
- [ ] Frame and map fade in sequentially
- [ ] Modal card rises and fades in when opened
- [ ] With `prefers-reduced-motion: reduce` (OS setting or DevTools emulation): no visible animations, modal appears instantly

---

## Testing Strategy

### Unit Tests

No changes to `src/lib/` — all unit tests should pass unchanged.

### E2E Tests (`bun run test:e2e`)

All existing selectors are preserved:

- `svg` present: ✓ (HexMap renders SVG)
- `polygon.first()` clickable: ✓ (faction hexes unchanged)
- `[role="dialog"]` visible after click: ✓ (Modal attr unchanged)
- `[data-testid="modal-backdrop"]` clickable to close: ✓ (unchanged)
- `h2` in dialog visible: ✓ (FactionDetail still renders `<h2>`)
- Mobile `h2` on faction page: ✓ (FactionDetail unchanged structurally)
- Back link navigates to `/`: ✓ (`href="/"` preserved)

### Manual Smoke Tests (after each phase)

1. Open home page — map loads, header present
2. Click a faction hex on desktop — modal opens with color-band matching the hex color
3. Press Escape — modal closes
4. Click backdrop corner — modal closes
5. On mobile viewport — click hex navigates to `/factions/[slug]`
6. On faction page — click `← RETURN TO MAP` → returns to `/`
7. Toggle `prefers-reduced-motion: reduce` in DevTools → no animations

---

## Performance Considerations

- `next/font` downloads fonts at build time; zero runtime network requests.
- `backdrop-filter: blur(3px)` on the modal backdrop is hardware-accelerated; acceptable for a single overlay.
- Scanline and vignette overlays are `position: fixed` with `pointer-events: none` — no reflow triggered.
- CSS custom property `--faction-color` injected per-polygon is a one-time render — no JS per-frame overhead.
- No new runtime dependencies added.

---

## References

- Aesthetic direction: Voidship Terminal, chosen 2026-05-22
- Current component inventory: all files under `src/components/` and `src/app/`
- E2E test selectors: `e2e/faction-flow.spec.ts`
- Related plan (hex territory sizes): `thoughts/shared/plans/2026-05-22-enlarge-faction-territories.md`
- `next/font` docs: fonts are CSS-variable-based, work with `output: 'export'`
