/**
 * Minimal path router for the JSON API. Supports `:param` segments. Kept tiny
 * and dependency-free; shared by all phases' route modules.
 */
import type { AppConfig } from "../lib/appconfig";
import type { DB } from "../db/index";
import type { Session } from "./sessions";

export interface ApiCtx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Present for session (web) auth; for API-key auth the route checks separately. */
  session: Session;
  db: DB;
  config: AppConfig;
  /** Optional shared services injected by the server (playback engine, ingest, …). */
  services: ApiServices;
}

/** Service handles the API can call into. Populated incrementally by later phases. */
export interface ApiServices {
  /** Audio prober for uploads/ingest (injected; real one shells out to ffmpeg). */
  prober?: import("../media/probe").AudioProber;
  /** YouTube ingest orchestration (jobs, downloads, loudness). */
  ingest?: import("./ingest").IngestService;
  /** SSE hub for download-job progress. */
  hub?: import("./jobhub").JobHub;
  playback?: unknown;
}

export type ApiHandler = (ctx: ApiCtx) => Response | Promise<Response>;

export interface ApiRoute {
  method: string;
  /** e.g. "/api/v1/tracks/:id" */
  path: string;
  handler: ApiHandler;
}

export interface MatchedRoute {
  route: ApiRoute;
  params: Record<string, string>;
}

/** Find the first route whose method + path template matches. */
export function matchRoute(routes: readonly ApiRoute[], method: string, pathname: string): MatchedRoute | null {
  const segs = pathname.split("/").filter((s) => s.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    const rsegs = route.path.split("/").filter((s) => s.length > 0);
    if (rsegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rsegs.length; i++) {
      const r = rsegs[i]!;
      const s = segs[i]!;
      if (r.startsWith(":")) params[r.slice(1)] = decodeURIComponent(s);
      else if (r !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parse a JSON request body, throwing HttpError(400) on malformed input. */
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

/** Parse a positive integer route param, throwing 400 otherwise. */
export function intParam(params: Record<string, string>, name: string): number {
  const n = Number(params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `invalid_${name}`);
  return n;
}
