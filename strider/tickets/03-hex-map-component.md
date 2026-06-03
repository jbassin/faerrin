# 03 — Hex Map Component

Build an interactive circular hex grid where each faction owns a radial wedge of approximately equal size. Clicking any hex fires a callback with the owning faction.

## Grid Geometry

- **Shape:** circular — all hexes with cube-coordinate radius ≤ 5 from center (91 hexes total, ~4–5 per faction)
- **Hex orientation:** pointy-top (standard for `react-hexgrid`)
- **Coordinate system:** axial (q, r) with s derived as `s = -q - r`

## Hex-to-Faction Assignment — `src/lib/hexUtils.ts`

```ts
// Convert axial (q, r) to Cartesian for angle computation
function axialToCartesian(q: number, r: number): [number, number] {
  const x = q + r / 2;
  const y = (r * Math.sqrt(3)) / 2;
  return [x, y];
}

// Returns faction index (0–19) for a given hex, or -1 for center
export function factionIndexForHex(q: number, r: number): number {
  if (q === 0 && r === 0) return 0; // center hex: assign to faction with order 1
  const [x, y] = axialToCartesian(q, r);
  const angle = Math.atan2(y, x);
  const normalized = angle < 0 ? angle + 2 * Math.PI : angle;
  return Math.floor(normalized / ((2 * Math.PI) / 20));
}

// Generate all axial coords within radius R
export function hexesInRadius(R: number): Array<[number, number]> {
  const hexes: Array<[number, number]> = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      hexes.push([q, r]);
    }
  }
  return hexes;
}
```

## Component — `src/components/HexMap/HexMap.tsx`

This is a Client Component (`'use client'`).

```ts
interface HexMapProps {
  factions: Faction[]; // sorted by order 1–20
  onFactionClick: (faction: Faction) => void;
}
```

Implementation notes:

- Use `react-hexgrid`'s `<HexGrid>`, `<Layout>`, `<Hexagon>` components
- Map each hex coord to a faction via `factionIndexForHex` → `factions[index]`
- Set `fill` on each `<Hexagon>` to `faction.color` (define SVG `<defs>` or use inline style)
- Hover: darken the hex color by 15% (CSS filter or computed color)
- The `<HexGrid>` should be wrapped in a container `div` that fills its parent width; use `viewBox` to make it responsive

## Rendering on the Home Page — `src/app/page.tsx`

`page.tsx` is a Server Component. It calls `getAllFactions()` and passes the result as a prop to `<HexMap>` (a Client Component). It also renders the `<Modal>` (ticket 04) conditionally based on client state; this requires lifting the map + modal into a single Client Component wrapper (e.g. `<MapView>`) that holds `selectedFaction` state.

Suggested structure:

```
src/app/page.tsx          (Server Component — fetches factions, renders <MapView>)
src/components/MapView/
  MapView.tsx             (Client Component — owns selectedFaction state, renders HexMap + Modal)
```

## Unit Tests — `src/lib/hexUtils.test.ts`

Add Vitest tests covering:

- `hexesInRadius(5)` returns exactly 91 hexes
- `hexesInRadius(0)` returns exactly 1 hex (the center)
- `hexesInRadius(R)` returns `3*R*(R+1) + 1` for several R values
- `factionIndexForHex(0, 0)` returns `0` (center special case)
- `factionIndexForHex` returns values in `[0, 19]` for all hexes in radius 5
- `factionIndexForHex` produces approximately balanced counts across 20 sectors (each sector should have 3–7 hexes for radius 5; verify by counting)
- Known anchor points: a hex directly east of center (e.g. axial (1, 0)) maps to sector 0; rotating 90° clockwise maps to sector 5 (within rounding)

## Success Criteria

- [x] `bun run test` passes (hexUtils.test.ts green)
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [ ] Map renders 91 hexes in a circular shape with no missing or extra hexes
- [ ] Each faction's wedge is visually distinct (correct color, approximately equal arc)
- [ ] Clicking any hex calls `onFactionClick` with the correct `Faction` object
- [ ] Hovering a hex produces a visible hover state
- [ ] Map scales to fill its container (no fixed pixel width)
