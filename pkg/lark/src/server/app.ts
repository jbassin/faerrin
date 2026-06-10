/**
 * The lark HTTP app (plan §7). Mirrors eerie's split: `createApp()` returns a
 * pure `handle(req)` that can be unit-tested without binding a port, opening a
 * real Discord connection, or hitting the network. `startServer()` binds it.
 *
 * Phase 1 wires: Discord OAuth login + signed sessions + allowlist, `/api/v1/me`,
 * and path-traversal-guarded SPA static serving. Library / playback / ingest
 * routes are layered on in later phases via `routes`.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { Server } from "bun";
import type { AppConfig } from "../lib/appconfig";
import type { DB } from "../db/index";
import { buildAuthorizeUrl, exchangeCodeForUser } from "./oauth";
import {
  type Session,
  clearCookie,
  parseCookies,
  sessionCookie,
  signSession,
  verifySession,
} from "./sessions";

const SESSION_COOKIE = "lark_session";
const OAUTH_STATE_COOKIE = "lark_oauth_state";

export interface AppDeps {
  /** Injectable fetch for the OAuth token/user exchange (tests stub this). */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Injectable clock (epoch ms). */
  now?: () => number;
  /** Injectable OAuth state generator. */
  makeState?: () => string;
}

export interface App {
  readonly db: DB;
  readonly config: AppConfig;
  handle(req: Request): Promise<Response>;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function createApp(config: AppConfig, db: DB, deps: AppDeps = {}): App {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const makeState = deps.makeState ?? (() => randomBytes(16).toString("hex"));

  /** Resolve the authenticated, allowlisted session for a request, or null. */
  function getSession(req: Request): Session | null {
    const cookies = parseCookies(req.headers.get("cookie"));
    const session = verifySession(cookies[SESSION_COOKIE], config.sessionSecret, now());
    if (!session) return null;
    if (config.allowlist.size > 0 && !config.allowlist.has(session.uid)) return null;
    return session;
  }

  function login(): Response {
    const state = makeState();
    const url = buildAuthorizeUrl(config.oauth, state);
    return new Response(null, {
      status: 302,
      headers: {
        location: url,
        "set-cookie": `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
          config.secureCookies ? "; Secure" : ""
        }`,
      },
    });
  }

  async function callback(req: Request, url: URL): Promise<Response> {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(req.headers.get("cookie"));
    if (!code || !state || state !== cookies[OAUTH_STATE_COOKIE]) {
      return json({ error: "invalid_oauth_state" }, 400);
    }
    let user;
    try {
      user = await exchangeCodeForUser(config.oauth, code, fetchImpl);
    } catch {
      return json({ error: "oauth_exchange_failed" }, 502);
    }
    if (config.allowlist.size > 0 && !config.allowlist.has(user.id)) {
      return json({ error: "not_allowlisted" }, 403);
    }
    const token = signSession(user.id, config.sessionSecret, undefined, now());
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        "set-cookie": sessionCookie(SESSION_COOKIE, token, { secure: config.secureCookies }),
      },
    });
  }

  function logout(): Response {
    return new Response(null, { status: 302, headers: { location: "/", "set-cookie": clearCookie(SESSION_COOKIE) } });
  }

  async function serveStatic(req: Request): Promise<Response> {
    const pathname = decodeURIComponent(new URL(req.url).pathname);
    const target = resolve(config.distDir, "." + pathname);
    if (target !== config.distDir && !target.startsWith(config.distDir + "/")) {
      return new Response("forbidden\n", { status: 403 });
    }
    const candidate = pathname === "/" || pathname.endsWith("/") ? resolve(target, "index.html") : target;
    let file = Bun.file(candidate);
    if (!(await file.exists())) {
      file = Bun.file(resolve(config.distDir, "index.html"));
      if (!(await file.exists())) return new Response("not found\n", { status: 404 });
    }
    return new Response(file);
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    // --- Auth ---
    if (req.method === "GET" && pathname === "/auth/login") return login();
    if (req.method === "GET" && pathname === "/auth/callback") return callback(req, url);
    if (req.method === "POST" && pathname === "/auth/logout") return logout();

    // --- API (session-guarded) ---
    if (pathname === "/api/v1/health") return json({ ok: true });
    if (pathname === "/api/v1/me") {
      const session = getSession(req);
      if (!session) return json({ error: "unauthenticated" }, 401);
      return json({ uid: session.uid });
    }

    // --- Static SPA ---
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req);
    return json({ error: "method_not_allowed" }, 405);
  }

  return { db, config, handle };
}

export interface RunningServer {
  server: Server<undefined>;
  app: App;
  stop(): void;
}

/** Bind the app to its configured port. */
export function startServer(config: AppConfig, db: DB, deps: AppDeps = {}): RunningServer {
  const app = createApp(config, db, deps);
  const server = Bun.serve({ port: config.port, fetch: app.handle });
  return { server, app, stop: () => server.stop(true) };
}
