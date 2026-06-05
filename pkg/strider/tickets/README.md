# Strider — Project Plan

> **Historical planning document.** This is the _original_ plan that drove tickets 01–05; the shipped
> implementation has since diverged. Notably: the framework is **TanStack Start (Vite)**, not Next.js;
> the map renderer is **`pixi.js`**, not `react-hexgrid`; and the grid is **radius-35 axial `(q, r)`**,
> not radius-5. For the current state, read [`../README.md`](../README.md) and
> [`../CLAUDE.md`](../CLAUDE.md). The plan below is kept as a record of the initial design intent.

An interactive city map website for the Strider, a city in a Pathfinder 2e campaign. The map shows the 20 factions that control the city, their territorial holdings, and allows players to explore each faction's identity and known members.

## Tech Stack

| Concern          | Choice                                   | Reason                                                                     |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| Framework        | Next.js (App Router, `output: 'export'`) | Static output for reverse proxy, built-in routing for faction pages        |
| Language         | TypeScript (strict)                      | Type safety across data model and components                               |
| Hex grid         | `react-hexgrid`                          | SVG-based, handles hex math, well-maintained                               |
| Markdown parsing | `gray-matter` + `remark`                 | Frontmatter + body rendering at build time                                 |
| Styling          | CSS Modules                              | No external dependency, co-located with components                         |
| Unit testing     | Vitest                                   | Fast, ESM-native, plays well with Next.js                                  |
| E2E testing      | Playwright                               | Multi-browser support, good for testing the responsive modal-vs-page split |
| Formatting       | Prettier (defaults)                      | Zero-config                                                                |
| Commits          | Conventional Commits                     | See `CLAUDE.md` for format                                                 |

## Data Model

Faction files live in `content/factions/*.md` with YAML frontmatter:

```yaml
---
name: Iron Brotherhood
slug: iron-brotherhood
color: "#8B4513"
order: 1          # 1–20 clockwise position on the map
symbol: null      # relative path to public/symbols/{slug}.svg, or null
---

Description paragraph.

## Known Members

### Member Name
Bio text.
```

Hex-to-faction assignment is computed at render time from each hex's angular position — no explicit hex lists stored in faction files. 20 factions × 18° = full 360°.

## Map Layout

- Circular hex grid, radius 5 (91 hexes total, ~4–5 per faction)
- Each hex assigned to the faction whose angular wedge (1/20th of circle) it falls in
- Assignment: `atan2(y, x)` → normalized angle → `floor(angle / (2π/20))` → faction index

## Responsive Behavior

- **Desktop (≥768px):** clicking a hex opens a modal overlay with faction details
- **Mobile (<768px):** clicking a hex navigates to `/factions/[slug]`

Both behaviors are implemented in a single client component using a `useIsMobile()` hook.

## Symbol Placeholder

Until real SVGs are available, factions render a placeholder: a circle filled with `faction.color` with the faction's initials (first letter of each word, max 2 chars) in white. When `public/symbols/{slug}.svg` exists, it is used instead.

## Tickets

| #                                           | Title                         | Depends on |
| ------------------------------------------- | ----------------------------- | ---------- |
| [01](01-project-scaffolding.md)             | Project Scaffolding           | —          |
| [02](02-content-schema-and-faction-data.md) | Content Schema & Faction Data | 01         |
| [03](03-hex-map-component.md)               | Hex Map Component             | 02         |
| [04](04-faction-detail-view.md)             | Faction Detail View           | 02         |
| [05](05-static-build-verification.md)       | Static Build Verification     | 03, 04     |
