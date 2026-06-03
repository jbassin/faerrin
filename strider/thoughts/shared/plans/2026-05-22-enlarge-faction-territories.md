# Enlarge Faction Territories Implementation Plan

## Overview

Enlarge each faction's territory so its circle reaches the outer edge of the hex map. Replace the current "exactly-one-claimant" assignment rule with a Voronoi (nearest-center-wins) rule capped by the new larger radius, so that overlap regions resolve cleanly instead of becoming neutral.

## Current State Analysis

`src/lib/hexUtils.ts` precomputes the hex-to-faction assignment once at module load:

- `RING_RADIUS = 85` — pixel distance from origin to each faction center (`hexUtils.ts:3`)
- `TERRITORY_RADIUS = 11` — pixel radius of each faction's circular territory (`hexUtils.ts:4`)
- `HEX_SIZE = 2` — pixel multiplier, matched in `<Layout size={{x:2,y:2}}>` (`HexMap.tsx:19`)
- 20 faction centers evenly spaced on the ring at angles `π/2 + k·(π/10)` for `k = 0..19` (`hexUtils.ts:14-18`)

Assignment rule (`hexUtils.ts:43-52`): for each hex, count how many faction circles contain it. If exactly one, the hex belongs to that faction; otherwise (zero or two-plus claimants), the hex is neutral.

This rule works today because adjacent faction centers are `2 × 85 × sin(π/20) ≈ 26.6 px` apart and the current radius (11) is below half that, so circles don't overlap. Increasing the radius beyond ~13.3 px starts producing overlapping claims, and under the current rule those overlapping hexes become neutral — defeating the goal of bigger territories.

`HexMap.tsx`, `MapView.tsx`, and `page.tsx` only consume the precomputed `FACTION_HEXES`/`NEUTRAL_HEXES`. They don't care how the assignment is computed, so no rendering-side changes are needed.

## Desired End State

After this plan is complete:

- Each faction's circular territory has pixel radius `TERRITORY_RADIUS = 16`. This is a starting value chosen for visual tuning: it's about half the inter-faction-center distance of 26.6 px (so neighboring circles just barely overlap) and large enough to noticeably grow each territory.
- A hex is assigned to the faction whose center is **nearest** to it among any whose center is within `TERRITORY_RADIUS`. Hexes farther than `TERRITORY_RADIUS` from every faction center remain neutral (this preserves a small neutral region near the origin).
- The outer ring of the hex map is mostly painted with faction colors; the neutral region is concentrated near the center of the map.
- All existing assertions about faction-territory placement (faction 19 in the upper half, faction 0 in the upper-left quadrant) continue to hold — faction centers haven't moved.

Verification: visually load the dev server and confirm faction circles touch the outer edge with no thick neutral border; `bun run test`, `bun run typecheck`, and `bun run lint` all pass.

### Key Discoveries

- `TERRITORY_RADIUS` is a single constant (`hexUtils.ts:4`) — bumping it is a one-line change.
- The "exactly one claimant" check is at `hexUtils.ts:48` and is the only piece of logic that needs to change to switch to Voronoi.
- Test expectations on territory size live at `hexUtils.test.ts:35-40` (the "20–55 hexes per faction" range) and will need adjustment for the larger Voronoi territories.
- The disjoint-claims invariant at `hexUtils.test.ts:42-51` continues to hold automatically under Voronoi assignment — each hex is assigned to at most one faction by construction.
- `factionCenterPixel` ordering (`hexUtils.ts:14-18`) is unchanged, so the angular-position tests (`hexUtils.test.ts:53-66`) still pass.

## What We're NOT Doing

- **Not** changing the faction-center ring layout (`RING_RADIUS`, the clock-order angle formula).
- **Not** changing the grid size (`GRID_RADIUS = 35`).
- **Not** changing the viewBox (`HexMap.tsx:18`).
- **Not** changing per-faction radii (every faction uses the same `TERRITORY_RADIUS`).
- **Not** changing rendering, styling, or interaction code in `HexMap.tsx`/`MapView.tsx`.
- **Not** removing the neutral hex concept — the central region (where every faction is > `TERRITORY_RADIUS` away) stays neutral.

## Implementation Approach

A single small, mechanical change to `src/lib/hexUtils.ts`:

1. Raise `TERRITORY_RADIUS` from 11 to 16.
2. In `computeAssignments`, for each hex, find the closest faction center; if its distance is `≤ TERRITORY_RADIUS`, assign the hex to that faction; otherwise mark it neutral.

Update the unit tests to match the new territory sizes. No other source files need to change.

## Phase 1: Voronoi Assignment + Larger Territory Radius

### Overview

Increase `TERRITORY_RADIUS` and switch the assignment rule from "exactly one circle contains it" to "nearest faction center within `TERRITORY_RADIUS` wins."

### Changes Required:

#### 1. Update assignment logic and constant

**File**: `src/lib/hexUtils.ts`
**Changes**: Bump `TERRITORY_RADIUS` to 25; rewrite the inner loop of `computeAssignments` to track the nearest faction.

Replace lines 4 and 36-54 (the `TERRITORY_RADIUS` constant and the `computeAssignments` loop body) with:

```ts
const TERRITORY_RADIUS = 16; // pixel radius of each faction's territory; visual tuning parameter
```

```ts
for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
  for (
    let r = Math.max(-GRID_RADIUS, -q - GRID_RADIUS);
    r <= Math.min(GRID_RADIUS, -q + GRID_RADIUS);
    r++
  ) {
    const [px, py] = hexPixel(q, r);
    let nearestIdx = -1;
    let nearestDist = Infinity;
    for (let i = 0; i < 20; i++) {
      const [cx, cy] = factionCenterPixel(i);
      const d = dist(px, py, cx, cy);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    if (nearestDist <= TERRITORY_RADIUS) {
      factionHexes[nearestIdx].push([q, r]);
    } else {
      neutralHexes.push([q, r]);
    }
  }
}
```

Update the doc-comment on `computeAssignments` (`hexUtils.ts:25-27`) to reflect the new rule: "A hex is assigned to its nearest faction center if that center is within `TERRITORY_RADIUS`; otherwise the hex is neutral."

#### 2. Update tests for larger territories

**File**: `src/lib/hexUtils.test.ts`
**Changes**: Widen the per-faction hex-count range to fit the new territory size.

Replace the assertion at lines 35-40:

```ts
it("every faction territory has 40–100 hexes (Voronoi within radius 16)", () => {
  for (const hexes of FACTION_HEXES) {
    expect(hexes.length).toBeGreaterThanOrEqual(40);
    expect(hexes.length).toBeLessThanOrEqual(100);
  }
});
```

The bounds 40 and 100 are loose enough to tolerate small radius tweaks during visual tuning. If the chosen radius is changed later, the bounds may need adjustment.

Add a new test asserting that the central neutral region exists (a sanity check that we didn't accidentally Voronoi-assign every hex):

```ts
it("keeps the origin hex neutral (no faction reaches the center under radius 16)", () => {
  const neutralKeys = new Set(NEUTRAL_HEXES.map(([q, r]) => `${q},${r}`));
  expect(neutralKeys.has("0,0")).toBe(true);
});
```

The existing tests for "no hex in more than one faction" (`hexUtils.test.ts:42-51`), coverage of the full grid (`hexUtils.test.ts:69-82`), and faction-19/faction-0 angular placement (`hexUtils.test.ts:53-66`) all continue to apply unchanged.

### Success Criteria:

#### Automated Verification:

- [x] Unit tests pass: `bun run test`
- [x] Type checking passes: `bun run typecheck`
- [x] Linting passes: `bun run lint`
- [x] Static build succeeds: `bun run build`

#### Manual Verification:

- [ ] `bun dev` — the rendered map shows each faction's territory reaching the outer hex-grid edge in at least the direction radial from the faction center.
- [ ] No thick neutral border separates neighboring factions (some inner neutral region near the origin is expected and desired).
- [ ] Clicking any faction-colored hex still selects the correct faction (sanity check — assignment math unchanged for nearest-faction in non-overlap regions).
- [ ] Hover state still works (no regression in `HexMap.module.css` interactions).

**Implementation Note**: After automated verification passes, pause for manual confirmation that the visual result matches the desired outcome before considering the plan complete. If the radius needs tuning, adjust the single `TERRITORY_RADIUS` constant and re-run the test suite; widen the 40–100 bound in the test if needed.

## Testing Strategy

### Unit Tests:

- The disjoint-claims invariant (each hex in at most one faction) is preserved by Voronoi by construction.
- The full-grid coverage test (faction + neutral hexes together equal the R=35 grid) is preserved.
- The new central-neutral sanity test ensures we didn't accidentally drop the radius cap.

### Manual Testing Steps:

1. Run `bun dev` and open `http://localhost:3000`.
2. Confirm the 20 faction regions visually reach the outer edge of the hex map.
3. Confirm there is still a small neutral region near the center of the map.
4. Click several factions and verify the click handler fires with the correct faction (no console errors).

## Performance Considerations

The assignment loop runs once at module load and visits each of ~3,781 hexes 20 times (~76k comparisons). No change in asymptotic cost from the current implementation. The dev server's first compile time and the static build are unaffected.

## Migration Notes

None. No persisted data; no users; no API surface. The change is purely a recomputation of `FACTION_HEXES`/`NEUTRAL_HEXES` at module load.

## References

- Original request: enlarge faction territories so their circles touch the outer hex-grid edge; resolve overlap via nearest-center (Voronoi).
- Current hex assignment logic: `src/lib/hexUtils.ts:26-57`
- Current tests: `src/lib/hexUtils.test.ts:24-67`
- Ticket containing original hex-map work: `tickets/03-hex-map-component.md`
