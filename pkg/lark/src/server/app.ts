/**
 * The lark HTTP app (plan §7). Mirrors eerie's split: `createApp()` returns a
 * pure `handle(req)` that can be unit-tested without binding a port, opening a
 * real Discord connection, or hitting the network. `startServer()` binds it.
 *
 * Layering: auth routes (login/callback/logout) and an open health check are
 * special-cased; everything under `/api/` is dispatched through the router and
 * guarded by a session (web) — API-key auth is layered on in Phase 5.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { Server } from "bun";
import type { AppConfig } from "../lib/appconfig";
import type { DB } from "../db/index";
import { buildAuthorizeUrl, exchangeCodeForUser } from "./oauth";
import { ingestRoutes } from "./routes/ingest";
import { libraryRoutes } from "./routes/library";
import { type ApiCtx, type ApiRoute, type ApiServices, HttpError, json, matchRoute } from "./router";
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

/** API routes that require a valid web session. Extended per phase. */
const API_ROUTES: ApiRoute[] = [...libraryRoutes, ...ingestRoutes];

export interface AppDeps {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  makeState?: () => string;
  /** Runtime service handles (prober, playback engine, ingest…). */
  services?: ApiServices;
}

export interface App {
  readonly db: DB;
  readonly config: AppConfig;
  handle(req: Request): Promise<Response>;
}

export function createApp(config: AppConfig, db: DB, deps: AppDeps = {}): App {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const makeState = deps.makeState ?? (() => randomBytes(16).toString("hex"));
  const services = deps.services ?? {};

  function getSession(req: Request): Session | null {
    const cookies = parseCookies(req.headers.get("cookie"));
    const session = verifySession(cookies[SESSION_COOKIE], config.sessionSecret, now());
    if (!session) return null;
    if (config.allowlist.size > 0 && !config.allowlist.has(session.uid)) return null;
    return session;
  }

  function login(): Response {
    const state = makeState();
    return new Response(null, {
      status: 302,
      headers: {
        location: buildAuthorizeUrl(config.oauth, state),
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
    if (!code || !state || state !== cookies[OAUTH_STATE_COOKIE]) return json({ error: "invalid_oauth_state" }, 400);
    let user;
    try {
      user = await exchangeCodeForUser(config.oauth, code, fetchImpl);
    } catch {
      return json({ error: "oauth_exchange_failed" }, 502);
    }
    if (config.allowlist.size > 0 && !config.allowlist.has(user.id)) return json({ error: "not_allowlisted" }, 403);
    const token = signSession(user.id, config.sessionSecret, undefined, now());
    return new Response(null, {
      status: 302,
      headers: { location: "/", "set-cookie": sessionCookie(SESSION_COOKIE, token, { secure: config.secureCookies }) },
    });
  }

  function logout(): Response {
    return new Response(null, { status: 302, headers: { location: "/", "set-cookie": clearCookie(SESSION_COOKIE) } });
  }

  async function dispatchApi(req: Request, url: URL): Promise<Response> {
    const session = getSession(req);
    if (!session) return json({ error: "unauthenticated" }, 401);
    const matched = matchRoute(API_ROUTES, req.method, url.pathname);
    if (!matched) return json({ error: "not_found" }, 404);
    const ctx: ApiCtx = { req, url, params: matched.params, session, db, config, services };
    try {
      return await matched.route.handler(ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("[lark] api error", err);
      return json({ error: "internal" }, 500);
    }
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

    if (req.method === "GET" && pathname === "/auth/login") return login();
    if (req.method === "GET" && pathname === "/auth/callback") return callback(req, url);
    if (req.method === "POST" && pathname === "/auth/logout") return logout();

    if (pathname === "/api/v1/health") return json({ ok: true });
    if (pathname.startsWith("/api/")) return dispatchApi(req, url);

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

export function startServer(config: AppConfig, db: DB, deps: AppDeps = {}): RunningServer {
  const app = createApp(config, db, deps);
  const server = Bun.serve({ port: config.port, fetch: app.handle });
  return { server, app, stop: () => server.stop(true) };
}
