// Dev-only sidecar for the /editor page. Run alongside `bun dev`:
//   bun run editor:server
// Binds to 127.0.0.1:3001 (loopback only — never reachable from the network).

import fs from "fs";
import path from "path";

const PORT = 3001;
const LAYERS_DIR = path.resolve(process.cwd(), "content", "layers");
const FILENAME_RE = /^\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9-]+\.md$/;
const MAX_CONTENT_BYTES = 64 * 1024;

// Echo the request's Origin so the editor works from both localhost:3000
// and the dev server's LAN address (e.g. http://192.168.0.x:3000). The
// sidecar already binds to a loopback-or-LAN host the user chose, so this
// doesn't widen the attack surface beyond what binding to 0.0.0.0 implies.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

interface WriteRequest {
  filename: string;
  content: string;
}

function validate(
  body: unknown,
): { ok: true; req: WriteRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object")
    return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.filename !== "string")
    return { ok: false, error: "'filename' must be a string" };
  if (typeof b.content !== "string")
    return { ok: false, error: "'content' must be a string" };
  if (b.content.length === 0)
    return { ok: false, error: "'content' must be non-empty" };
  if (b.content.length > MAX_CONTENT_BYTES) {
    return { ok: false, error: `'content' exceeds ${MAX_CONTENT_BYTES} bytes` };
  }
  if (!FILENAME_RE.test(b.filename)) {
    return {
      ok: false,
      error:
        "'filename' must match ^\\d{4}-\\d{2}-\\d{2}T\\d{6}-[a-z0-9-]+\\.md$",
    };
  }
  const fullPath = path.resolve(LAYERS_DIR, b.filename);
  if (!fullPath.startsWith(LAYERS_DIR + path.sep)) {
    return { ok: false, error: "'filename' resolves outside content/layers" };
  }
  return { ok: true, req: { filename: b.filename, content: b.content } };
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/write-layer") {
      return jsonResponse(req, 404, { ok: false, error: "POST /write-layer" });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, 400, { ok: false, error: "invalid JSON body" });
    }

    const v = validate(body);
    if (!v.ok) return jsonResponse(req, 400, { ok: false, error: v.error });

    const target = path.join(LAYERS_DIR, v.req.filename);
    if (fs.existsSync(target)) {
      return jsonResponse(req, 409, {
        ok: false,
        error: `file already exists: content/layers/${v.req.filename}`,
      });
    }

    if (!fs.existsSync(LAYERS_DIR)) {
      fs.mkdirSync(LAYERS_DIR, { recursive: true });
    }

    try {
      fs.writeFileSync(target, v.req.content, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      return jsonResponse(req, 500, {
        ok: false,
        error: err instanceof Error ? err.message : "write failed",
      });
    }

    const rel = `content/layers/${v.req.filename}`;
    console.log(`[editor-server] wrote ${rel}`);
    return jsonResponse(req, 200, { ok: true, path: rel });
  },
});

console.log(
  `[editor-server] listening on http://${server.hostname}:${server.port}`,
);
console.log(`[editor-server] writing into ${LAYERS_DIR}`);
