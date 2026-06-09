#!/usr/bin/env bun
/**
 * Vellum render service (M3). Warm Bun + Playwright sidecar that turns a posted
 * document into a PNG of its [data-vellum-export] card. Serves the built render
 * assets from dist/ on the same origin so the render page + fonts load locally
 * (and the SEC-3 egress block can allow only same-origin).
 *
 *   bun run render:server        # after `bun run build`
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RenderService, RenderCapError } from "../src/server/renderService.ts";
import { validateRenderRequest } from "../src/server/caps.ts";

const PORT = Number(process.env.VELLUM_RENDER_PORT ?? 5252);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DIST = resolve(fileURLToPath(new URL("..", import.meta.url)), "dist");

// SEC-5: coarse per-IP fixed-window rate limit in front of the browser pool.
const RATE = { windowMs: 60_000, max: 60 };
const hits = new Map<string, { count: number; start: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE.windowMs) {
    hits.set(ip, { count: 1, start: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE.max;
}

const ALLOWED_ORIGINS = [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/, /^https:\/\/vellum\.iridi\.cc$/];
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return allow
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, GET, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin",
      }
    : {};
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  // Resolve inside DIST only — no path traversal.
  const full = resolve(DIST, `.${rel}`);
  if (!full.startsWith(DIST)) return new Response("forbidden", { status: 403 });
  const file = Bun.file(full);
  if (await file.exists()) return new Response(file);
  return new Response("not found", { status: 404 });
}

const service = new RenderService(BASE_URL);
await service.start();
console.log(`[vellum] render service warming Chromium…`);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 30,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health") {
      return Response.json(
        { ok: true, ready: service.isReady(), queued: service.queued },
        { headers: cors },
      );
    }

    if (url.pathname === "/render" && req.method === "POST") {
      const ip = srv.requestIP(req)?.address ?? "unknown";
      if (rateLimited(ip)) {
        return new Response("rate limited", { status: 429, headers: cors });
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response("invalid JSON", { status: 400, headers: cors });
      }
      const validation = validateRenderRequest(body);
      if (!validation.ok) {
        return new Response(validation.error, {
          status: validation.status,
          headers: cors,
        });
      }
      try {
        const png = await service.render(validation.value);
        return new Response(new Uint8Array(png), {
          headers: { ...cors, "content-type": "image/png" },
        });
      } catch (err) {
        if (err instanceof RenderCapError) {
          return new Response(err.message, { status: err.status, headers: cors });
        }
        console.error("[vellum] render failed:", err);
        return new Response("render failed", { status: 500, headers: cors });
      }
    }

    // Same-origin render assets (render.html, /assets/*, /fonts/*).
    return serveStatic(url.pathname);
  },
});

console.log(`[vellum] render service on ${BASE_URL} (ready=${service.isReady()})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void service.close().then(() => {
      server.stop(true);
      process.exit(0);
    });
  });
}
