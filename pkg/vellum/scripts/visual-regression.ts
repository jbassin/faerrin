#!/usr/bin/env bun
/**
 * Golden-image visual regression (NFR-9). Renders each fixture through the real
 * render service and compares the PNG to a committed golden with a perceptual
 * tolerance. Goldens are authoritative ONLY in the pinned CI container, so they
 * are generated there (`dagger call update-goldens`); see the Dagger module.
 *
 *   bun run scripts/visual-regression.ts            # compare (exit 1 on drift)
 *   bun run scripts/visual-regression.ts --update   # (re)write goldens
 *
 * Requires a prior `vite build` (the render service serves dist/).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { RenderService } from "../src/server/renderService.ts";
import { FIXTURES } from "../test/visual/fixtures.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = resolve(ROOT, "dist");
const GOLDEN = resolve(ROOT, "test/visual/golden");
const PORT = Number(process.env.VELLUM_VR_PORT ?? 5350);
const BASE = `http://127.0.0.1:${PORT}`;
const UPDATE = process.argv.includes("--update");
/** Allow up to 0.5% of pixels to differ (cross-render AA/hinting slack). */
const MAX_DIFF_RATIO = 0.005;

if (!(await Bun.file(resolve(DIST, "render.html")).exists())) {
  throw new Error(`${DIST}/render.html not found — run \`bun run build\` first`);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const full = resolve(DIST, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!full.startsWith(DIST)) return new Response("forbidden", { status: 403 });
    const file = Bun.file(full);
    return (await file.exists())
      ? new Response(file)
      : new Response("not found", { status: 404 });
  },
});

const service = new RenderService(BASE);
await service.start();

let failures = 0;
try {
  for (const fx of FIXTURES) {
    const png = Buffer.from(
      await service.render({
        source: fx.source,
        mode: fx.mode,
        scale: fx.scale ?? 2,
      }),
    );
    const goldenPath = resolve(GOLDEN, `${fx.name}.png`);

    if (UPDATE) {
      await Bun.write(goldenPath, png);
      console.log(`updated  ${fx.name}`);
      continue;
    }

    if (!(await Bun.file(goldenPath).exists())) {
      console.error(`MISSING  ${fx.name} (run --update in the CI container)`);
      failures += 1;
      continue;
    }

    const actual = PNG.sync.read(png);
    const golden = PNG.sync.read(
      Buffer.from(await Bun.file(goldenPath).arrayBuffer()),
    );
    if (actual.width !== golden.width || actual.height !== golden.height) {
      console.error(
        `DIM      ${fx.name}: ${actual.width}x${actual.height} vs golden ${golden.width}x${golden.height}`,
      );
      failures += 1;
      continue;
    }

    const diff = new PNG({ width: actual.width, height: actual.height });
    const changed = pixelmatch(
      actual.data,
      golden.data,
      diff.data,
      actual.width,
      actual.height,
      { threshold: 0.1 },
    );
    const ratio = changed / (actual.width * actual.height);
    if (ratio > MAX_DIFF_RATIO) {
      console.error(`FAIL     ${fx.name}: ${(ratio * 100).toFixed(3)}% changed`);
      failures += 1;
    } else {
      console.log(`ok       ${fx.name}: ${(ratio * 100).toFixed(3)}% changed`);
    }
  }
} finally {
  await service.close();
  server.stop(true);
}

if (!UPDATE && failures > 0) {
  console.error(`\nvisual regression: ${failures} fixture(s) failed`);
  process.exit(1);
}
console.log(UPDATE ? "\ngoldens updated" : "\nvisual regression passed");
