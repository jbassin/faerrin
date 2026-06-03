# 05 — Static Build Verification

Verify the complete static build produces correct output and works correctly when served as a static site — matching what the reverse proxy will serve.

## Steps

### 1. Full check suite

Run the complete check pipeline; all must exit 0:

```bash
bun run lint
bun run typecheck
bun run test
bun run test:e2e
```

### 2. Clean build

```bash
rm -rf .next out
bun run build
```

Must exit 0 with no TypeScript or Next.js errors.

### 3. Verify output structure

```
out/
  index.html
  factions/
    {slug}/
      index.html    ← must exist for all 20 factions
  _next/
    static/
      ...
```

Quick check:

```bash
ls out/factions | wc -l   # must print 20
```

### 4. Serve locally and manually verify

```bash
bunx serve out
```

Open `http://localhost:3000` and verify:

- [x] Hex map renders with all 20 colored faction wedges
- [x] Hovering a hex shows a hover state
- [x] Desktop: clicking a hex opens the modal with correct faction name, placeholder symbol, and description
- [x] Desktop: modal closes on Escape and backdrop click
- [x] Mobile (resize to <768px or DevTools): clicking a hex navigates to the faction page
- [x] Faction page renders name, symbol placeholder, description, and members
- [x] Back button on faction page returns to home
- [x] Browser back/forward navigation works correctly
- [x] No errors in browser console

### 5. Asset path check

If the reverse proxy serves the site from a subpath (e.g. `/strider/`), configure `next.config.ts`:

```ts
const config: NextConfig = {
  output: "export",
  basePath: "/strider", // add only if needed
  assetPrefix: "/strider", // add only if needed
};
```

Rebuild and re-verify after adding `basePath`. If the proxy serves from root, this step is a no-op.

## Success Criteria

- [x] `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:e2e` all exit 0
- [x] `bun run build` exits 0
- [x] `out/factions/` contains exactly 20 subdirectories
- [x] All manual verification items above pass
- [x] No 404s or asset errors in browser console when served from `out/`
