import { resolve } from "node:path";
import type { Server } from "bun";
import { RollHub } from "./hub";
import { parseRollEvent } from "./schema";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

export interface AppOptions {
  /** Shared secret required as the `X-Eerie-Token` header on ingest. null = open (dev). */
  token: string | null;
  /** Absolute path to the built overlay (vite `dist/`). */
  distDir: string;
  /** Inject a hub (tests); otherwise a fresh one is created. */
  hub?: RollHub;
}

export interface RunningServer {
  server: Server<undefined>;
  hub: RollHub;
  stop(): void;
}

/** Build the request handler + its hub without binding a port (unit-testable). */
export function createApp(opts: AppOptions): {
  hub: RollHub;
  handle: (req: Request) => Promise<Response>;
} {
  const hub = opts.hub ?? new RollHub();
  const { token, distDir } = opts;

  async function ingest(req: Request): Promise<Response> {
    if (token !== null && req.headers.get("x-eerie-token") !== token) {
      return new Response("unauthorized\n", { status: 401 });
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("invalid json\n", { status: 400 });
    }
    const event = parseRollEvent(body);
    if (!event) return new Response("invalid roll payload\n", { status: 400 });
    hub.publish(event);
    return new Response(null, { status: 204 });
  }

  function feed(): Response {
    let off: (() => void) | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const client = (frame: string) => {
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            off?.();
          }
        };
        off = hub.add(client);
        client(": connected\n\n");
      },
      cancel() {
        off?.();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  async function serveStatic(req: Request): Promise<Response> {
    const pathname = decodeURIComponent(new URL(req.url).pathname);
    const target = resolve(distDir, "." + pathname);
    // Path-traversal guard: resolved path must stay within distDir.
    if (target !== distDir && !target.startsWith(distDir + "/")) {
      return new Response("forbidden\n", { status: 403 });
    }
    const candidate =
      pathname === "/" || pathname.endsWith("/") ? resolve(target, "index.html") : target;

    let file = Bun.file(candidate);
    if (!(await file.exists())) {
      // SPA fallback — unknown client routes serve the overlay shell.
      file = Bun.file(resolve(distDir, "index.html"));
      if (!(await file.exists())) return new Response("not found\n", { status: 404 });
    }
    const headers: Record<string, string> = {};
    if (candidate.endsWith("index.html")) headers["cache-control"] = "no-cache";
    return new Response(file, { headers });
  }

  async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/api/v1/roll") return ingest(req);
    if (req.method === "GET" && pathname === "/feed") return feed();
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req);
    return new Response("method not allowed\n", { status: 405 });
  }

  return { hub, handle };
}

/** Bind the app to a port and start the heartbeat. Returns a stop() for teardown. */
export function startServer(opts: AppOptions & { port: number }): RunningServer {
  const { hub, handle } = createApp(opts);
  const server = Bun.serve({ port: opts.port, fetch: handle });
  const heartbeat = setInterval(() => hub.heartbeat(), 15_000);
  // Don't keep the event loop alive on the heartbeat alone (matters in tests).
  (heartbeat as { unref?: () => void }).unref?.();
  return {
    server,
    hub,
    stop() {
      clearInterval(heartbeat);
      server.stop(true);
    },
  };
}
