import { chromium } from "playwright";
import type { Browser } from "playwright";
import { Semaphore } from "./semaphore.ts";
import { RENDER_LIMITS, type RenderRequest } from "./caps.ts";

/** Error carrying an HTTP status, for caps hit mid-render (SEC-4). */
export class RenderCapError extends Error {
  readonly status: number;
  constructor(message: string, status = 413) {
    super(message);
    this.name = "RenderCapError";
    this.status = status;
  }
}

/**
 * Warm-browser render service (OQ-1). Holds one Chromium for the life of the
 * process; each request gets a fresh, isolated context (per-request isolation),
 * with all network egress blocked except same-origin render assets (SEC-3) and
 * a concurrency gate in front of the shared browser (SEC-5).
 */
export class RenderService {
  private browser: Browser | null = null;
  private readonly gate: Semaphore;

  constructor(
    private readonly baseUrl: string,
    concurrency = 2,
  ) {
    this.gate = new Semaphore(concurrency);
  }

  get queued(): number {
    return this.gate.queued;
  }

  async start(): Promise<void> {
    this.browser = await chromium.launch({ args: ["--no-sandbox"] });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  isReady(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  async render(req: RenderRequest): Promise<Buffer> {
    const browser = this.browser;
    if (!browser) throw new RenderCapError("render service not started", 503);

    return this.gate.run(async () => {
      const context = await browser.newContext({
        deviceScaleFactor: req.scale,
      });
      try {
        // SEC-3: block ALL network except same-origin render assets + data URIs.
        // Author-supplied URLs (images, remote fonts) never reach the network.
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (url.startsWith(this.baseUrl) || url.startsWith("data:")) {
            void route.continue();
          } else {
            void route.abort();
          }
        });

        const page = await context.newPage();
        page.setDefaultTimeout(RENDER_LIMITS.renderTimeoutMs);

        await page.goto(`${this.baseUrl}/render.html`, { waitUntil: "load" });
        await page.evaluate(
          ([source, mode]) =>
            (
              window as unknown as {
                vellumRender: (s: string, m: string) => Promise<void>;
              }
            ).vellumRender(source, mode),
          [req.source, req.mode] as const,
        );

        const target = page.locator("[data-vellum-export]");
        await target.waitFor({ state: "visible" });

        // SEC-4: reject pathologically large rasters before screenshotting.
        const box = await target.boundingBox();
        if (
          box &&
          box.width * box.height * req.scale * req.scale >
            RENDER_LIMITS.maxPixelArea
        ) {
          throw new RenderCapError("rendered output exceeds pixel cap", 422);
        }

        return await target.screenshot({ type: "png" });
      } finally {
        await context.close();
      }
    });
  }
}
