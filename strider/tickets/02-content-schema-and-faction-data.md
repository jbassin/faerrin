# 02 — Content Schema & Faction Data

Define the markdown/YAML frontmatter schema for faction files, implement the data-loading library, and create placeholder files for all 20 factions.

## Frontmatter Schema

Files are named `{order:02d}-{slug}.md` (e.g. `01-iron-brotherhood.md`). `order` and `slug` are derived from the filename and must not appear in frontmatter.

```yaml
name: string # Display name of the faction
color: string # CSS hex color used on the map and in UI
symbol: null # null until SVG is available; set to "symbols/{slug}.svg" when ready
```

The markdown body contains:

1. A description paragraph (free prose, before any headings)
2. An optional `## Known Members` section, where each member is a `### Member Name` subsection followed by their bio

## Example file — `content/factions/iron-brotherhood.md`

```markdown
---
name: Iron Brotherhood
slug: iron-brotherhood
color: "#8B4513"
order: 1
symbol: null
---

A guild of blacksmiths and weapon-crafters who control the foundry district.
Fiercely independent, they sell to any buyer with coin.

## Known Members

### Theron Vask

Guild master and former city guard. Known for his temper and fair prices.

### Mira Coilspring

Head of the tinkerers' annex. Rumored to be developing a steam-powered forge.
```

## TypeScript Types — `src/lib/factions.ts`

```ts
export interface Faction {
  name: string;
  slug: string;
  color: string;
  order: number;
  symbol: string | null;
  description: string; // HTML string rendered from the body before ## headings
  members: Member[];
}

export interface Member {
  name: string;
  bio: string; // HTML string
}
```

## Data Loading Functions

Implement in `src/lib/factions.ts` using Node `fs` (runs only at build time in Server Components):

- `getAllFactions(): Faction[]` — reads `content/factions/*.md`, parses with `gray-matter`, renders markdown body to HTML with `remark`, returns array sorted by `order` ascending
- `getFactionBySlug(slug: string): Faction | null` — reads a single file

`getAllFactions` must be called from Server Components only. Mark the module with a comment noting this constraint.

## 20 Placeholder Faction Files

Create `content/factions/{slug}.md` for all 20 factions with:

- Unique, thematic names (Pathfinder 2e urban flavour — guilds, cults, noble houses, criminal syndicates, etc.)
- Distinct colors spread across the hue wheel (avoid colors too similar to each other)
- `order` values 1 through 20 (one per file, no duplicates)
- `symbol: null`
- A one-sentence stub description and at least one placeholder member

Suggested color spread (adjust hue every ~18°):

| order | suggested hue                                   |
| ----- | ----------------------------------------------- |
| 1     | #C0392B (red)                                   |
| 2     | #E67E22 (orange)                                |
| 3     | #F1C40F (yellow)                                |
| 4     | #27AE60 (green)                                 |
| 5     | #1ABC9C (teal)                                  |
| 6     | #2980B9 (blue)                                  |
| 7     | #8E44AD (purple)                                |
| 8     | #D35400 (burnt orange)                          |
| 9     | #16A085 (dark teal)                             |
| 10    | #2C3E50 (dark navy)                             |
| 11    | #7F8C8D (slate)                                 |
| 12    | #C0392B (crimson — vary lightness from order 1) |
| 13    | #6C3483 (deep purple)                           |
| 14    | #148F77 (forest green)                          |
| 15    | #1A5276 (steel blue)                            |
| 16    | #784212 (dark brown)                            |
| 17    | #922B21 (dark red)                              |
| 18    | #1E8BC3 (sky blue)                              |
| 19    | #196F3D (dark green)                            |
| 20    | #5D6D7E (blue-grey)                             |

(Adjust as needed to avoid perceptual clashes.)

## Unit Tests — `src/lib/factions.test.ts`

Add Vitest tests covering:

- `getAllFactions()` returns exactly 20 factions
- Returned factions are sorted by `order` ascending (1, 2, …, 20)
- No duplicate `slug` values; no duplicate `order` values
- `getFactionBySlug('iron-brotherhood')` returns the matching faction
- `getFactionBySlug('does-not-exist')` returns `null`
- Parsed `description` is non-empty HTML for each faction
- A faction with members in its markdown body produces a non-empty `members` array; bios are non-empty HTML

## Success Criteria

- [x] 20 `.md` files exist in `content/factions/`, one per faction
- [x] `bun run test` passes (factions.test.ts green)
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `getAllFactions()` returns exactly 20 factions sorted by `order` 1–20
- [x] No two factions share the same `order` or `slug`
