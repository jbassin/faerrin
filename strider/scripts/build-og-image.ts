#!/usr/bin/env bun
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.resolve(ROOT, "dist/client");
const OUT = path.resolve(DIST, "og-map.png");
const PORT = 4173;

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
    await target.screenshot({ path: OUT });
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
  } finally {
    await browser.close();
  }
} finally {
  server.stop(true);
}
