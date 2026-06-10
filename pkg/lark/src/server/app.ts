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
import * as repo from "../db/repo";
import { extractApiKey, hashKey } from "./apikeys";
import { ingestRoutes } from "./routes/ingest";
import { keyRoutes } from "./routes/keys";
import { libraryRoutes } from "./routes/library";
import { playbackRoutes } from "./routes/playback";
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

/** API routes that require a valid web session. Extended per phase. */
const API_ROUTES: ApiRoute[] = [...libraryRoutes, ...ingestRoutes, ...playbackRoutes, ...keyRoutes];

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

  /** Resolve the actor from a web session OR a Stream Deck API key (B26/D4). */
  function authenticate(req: Request): { session: Session; method: "session" | "apikey" } | null {
    const session = getSession(req);
    if (session) return { session, method: "session" };

    const raw = extractApiKey(req.headers);
    if (raw) {
      const key = repo.getApiKeyByHash(db, hashKey(raw));
      if (key && !key.revoked_at && (config.allowlist.size === 0 || config.allowlist.has(key.user_id))) {
        repo.touchApiKey(db, key.id);
        return { session: { uid: key.user_id, exp: Math.floor(now() / 1000) + 60 }, method: "apikey" };
      }
    }
    return null;
  }

  function login(): Response {
    // Stateless CSRF: the `state` is an HMAC-signed, self-expiring token (10 min)
    // rather than a value we must round-trip in a cookie. This avoids the whole
    // class of SameSite/Secure/lost-cookie failures (invalid_oauth_state).
    const state = signSession(makeState(), config.sessionSecret, 600, now());
    return new Response(null, { status: 302, headers: { location: buildAuthorizeUrl(config.oauth, state) } });
  }

  async function callback(req: Request, url: URL): Promise<Response> {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // The "Add to Server" (bot install) flow redirects here with guild_id/
    // permissions and no login `state` — a different OAuth flow. Guide the user
    // instead of returning a confusing invalid_oauth_state.
    if (url.searchParams.has("guild_id") || url.searchParams.has("permissions")) {
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>lark</title>` +
          `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#0e0f13;color:#e7e9ee">` +
          `<h1>lark</h1><p>✅ lark is added to your server. To control playback, ` +
          `<a style="color:#c8a24a" href="/">open the app</a> and click <b>Sign in with Discord</b>.</p></body>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (!code || !verifySession(state ?? undefined, config.sessionSecret, now())) {
      return json({ error: "invalid_oauth_state" }, 400);
    }
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
    const auth = authenticate(req);
    if (!auth) return json({ error: "unauthenticated" }, 401);
    const matched = matchRoute(API_ROUTES, req.method, url.pathname);
    if (!matched) return json({ error: "not_found" }, 404);
    const ctx: ApiCtx = {
      req,
      url,
      params: matched.params,
      session: auth.session,
      authMethod: auth.method,
      db,
      config,
      services,
    };
    try {
      return await matched.route.handler(ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      // PlaybackError and similar carry a numeric `status`.
      const status = (err as { status?: unknown }).status;
      if (typeof status === "number") return json({ error: (err as Error).message ?? "error" }, status);
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
