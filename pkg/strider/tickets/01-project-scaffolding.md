# 01 — Project Scaffolding

Bootstrap the Next.js + TypeScript project with static export configured, all required dependencies installed, and a folder structure ready for subsequent tickets.

## Steps

### 1. Initialize Next.js

```bash
bunx create-next-app@latest . --typescript --eslint --app --no-tailwind --src-dir --no-import-alias
```

### 2. Configure static export

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
};

export default config;
```

### 3. Install dependencies

Runtime:

```bash
bun add react-hexgrid gray-matter remark remark-html
```

Dev — testing & tooling:

```bash
bun add --dev @types/node prettier
bun add --dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom vite-tsconfig-paths
bun add --dev @playwright/test
bunx playwright install --with-deps
```

### 4. Add scripts

Add to `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "format": "prettier --write ."
  }
}
```

### 5. Test configuration

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "bun run build && bunx serve out -l 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://localhost:3000" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
```

Install `serve` as a dev dep for Playwright's webServer:

```bash
bun add --dev serve
```

### 6. Establish folder structure

```
src/
  app/
    layout.tsx          # root layout
    page.tsx            # home page (map)
    factions/
      [slug]/
        page.tsx        # mobile faction detail page
  components/
    HexMap/
      HexMap.tsx
      HexMap.module.css
    FactionDetail/
      FactionDetail.tsx
      FactionDetail.module.css
    Modal/
      Modal.tsx
      Modal.module.css
  lib/
    factions.ts         # data loading + types
    hexUtils.ts         # hex-to-faction assignment math
content/
  factions/             # populated in ticket 02
public/
  symbols/              # faction SVGs added later
e2e/                    # Playwright tests (populated in ticket 04)
tickets/
```

Remove the boilerplate content from `src/app/page.tsx` and `src/app/globals.css` that `create-next-app` generates.

### 7. TypeScript config

Ensure `tsconfig.json` has `"strict": true`. `create-next-app` sets this by default.

## Success Criteria

- [x] `bun dev` starts without errors and serves a blank page at `localhost:3000`
- [x] `bun run build` produces an `out/` directory
- [x] `bun run lint` passes with no errors
- [x] `bun run typecheck` passes with no errors
- [x] `bun run test` runs (no tests yet, but Vitest must exit 0)
- [x] `bun run test:e2e` runs (no tests yet, but Playwright must exit 0)
- [x] `bun run format` succeeds
- [x] TypeScript strict mode is enabled (`tsconfig.json` has `"strict": true`)
- [x] Folder structure matches the layout above
