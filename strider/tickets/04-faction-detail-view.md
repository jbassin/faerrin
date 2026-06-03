# 04 — Faction Detail View

Build the shared `FactionDetail` component and wire it into two entry points: a modal overlay on desktop and a dedicated static page on mobile.

## Shared Component — `src/components/FactionDetail/FactionDetail.tsx`

Renders the full faction profile. Accepts a single `faction: Faction` prop.

Layout (top to bottom):

1. **Symbol** — see symbol rules below
2. **Name** — `<h2>` with `faction.name`
3. **Description** — render `faction.description` as HTML (`dangerouslySetInnerHTML` is acceptable here since content is authored in this repo)
4. **Known Members** — for each entry in `faction.members`, render `<h3>` with member name and the bio as HTML below it

### Symbol Rules

```ts
// If symbol path is present:
<img src={`/${faction.symbol}`} alt={`${faction.name} symbol`} />

// If symbol is null — render placeholder:
<div
  style={{ background: faction.color }}
  aria-label={`${faction.name} symbol placeholder`}
>
  {initials(faction.name)}   // first letter of each word, max 2 chars, uppercase
</div>
```

The placeholder `div` should be a fixed-size circle (e.g. 80×80px) with white text centered inside.

## Desktop: Modal — `src/components/Modal/Modal.tsx`

- Semi-transparent backdrop covering the full viewport
- Centered card containing `<FactionDetail>`
- Close triggers: backdrop click, Escape key
- Trap focus within the modal while open (for accessibility)
- Rendered inside `<MapView>` (see ticket 03); `selectedFaction: Faction | null` state lives in `<MapView>`

```ts
interface ModalProps {
  faction: Faction | null; // null = closed
  onClose: () => void;
}
```

## Mobile: Static Page — `src/app/factions/[slug]/page.tsx`

Server Component. Implements `generateStaticParams` to satisfy `output: 'export'`:

```ts
export async function generateStaticParams() {
  const factions = getAllFactions();
  return factions.map((f) => ({ slug: f.slug }));
}
```

Page renders:

- A back button linking to `/` (use `<Link href="/">`)
- `<FactionDetail faction={faction} />`

`<FactionDetail>` is a Server Component here (no interactivity needed on this page) — pass `faction` as a prop fetched via `getFactionBySlug(slug)`.

## Responsive Routing — `useIsMobile` hook

```ts
// src/lib/useIsMobile.ts
"use client";
import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false); // default false (SSR-safe)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}
```

In `<MapView>`, on hex click:

```ts
const isMobile = useIsMobile();
const router = useRouter();

function handleFactionClick(faction: Faction) {
  if (isMobile) {
    router.push(`/factions/${faction.slug}`);
  } else {
    setSelectedFaction(faction);
  }
}
```

Note: on first render, `isMobile` is `false` (SSR-safe default). This means a mobile user who clicks before the `useEffect` fires will see the modal briefly. This is an acceptable edge case for a static site with fast local loads.

## E2E Tests — `e2e/faction-flow.spec.ts`

Add Playwright tests with two projects (`desktop` and `mobile`, configured in `playwright.config.ts`).

**Desktop project:**

- Home page loads and shows the hex map
- Clicking a hex opens the modal (modal contains the clicked faction's name)
- Pressing Escape closes the modal
- Clicking the backdrop closes the modal
- URL remains `/` after opening and closing the modal

**Mobile project:**

- Home page loads and shows the hex map
- Clicking a hex navigates to `/factions/{slug}`
- The faction page renders the faction's name
- Clicking the back button returns to `/`

## Success Criteria

- [ ] `bun run test:e2e` passes (both desktop and mobile projects green)
- [x] `bun run typecheck` passes
- [x] `bun run lint` passes
- [x] `FactionDetail` renders name, placeholder symbol, description, and member list for a faction with `symbol: null`
- [x] Desktop (≥768px): clicking a hex opens the modal; Escape and backdrop click close it
- [x] Mobile (<768px): clicking a hex navigates to `/factions/{slug}`
- [x] All 20 faction pages are present in `out/factions/` after `bun run build`
- [x] Back button on faction page returns to home
