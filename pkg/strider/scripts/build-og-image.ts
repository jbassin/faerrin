#!/usr/bin/env bun
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.resolve(ROOT, "dist/client");
const OUT = path.resolve(DIST, "og-map.png");
const PORT = 4173;
// Generous timeout: under a loaded CI runner the Pixi map can be slow to reach
// `data-map-ready`, and the map's continuous animations make the screenshot
// element slow to settle — Playwright's 30s defaults flake here intermittently.
const TIMEOUT = 90_000;

if (!(await Bun.file(path.join(DIST, "index.html")).exists())) {
  throw new Error(`${DIST}/index.html not found — run \`vite build\` first`);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const candidates = pathname.endsWith("/")
      ? [path.join(DIST, pathname, "index.html")]
      : [
          path.join(DIST, pathname),
          path.join(DIST, pathname, "index.html"),
          path.join(DIST, `${pathname}.html`),
        ];
    for (const candidate of candidates) {
      const file = Bun.file(candidate);
      if (await file.exists()) return new Response(file);
    }
    return new Response("not found", { status: 404 });
  },
});

try {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 900, height: 1000 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);
    page.setDefaultNavigationTimeout(TIMEOUT);
    await page.goto(`http://localhost:${PORT}/?seen`, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);
    const target = page.locator('[data-og-target="frame"]');
    await target.waitFor({ state: "visible" });
    await page.waitForSelector(
      '[data-og-target="frame"] [data-map-ready="true"]',
    );
    // Frame has a 400ms fade-in with 300ms delay; wait it out.
    await page.waitForTimeout(800);
    // Freeze CSS animations and give the screenshot a generous timeout so a
    // still-settling element under CI load doesn't flake the build.
    await target.screenshot({ path: OUT, timeout: TIMEOUT, animations: "disabled" });
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
  } finally {
    await browser.close();
  }
} finally {
  server.stop(true);
}
