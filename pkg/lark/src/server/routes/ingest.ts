/**
 * YouTube ingest API + SSE progress (plan B20–B22). Session-guarded.
 */
import * as repo from "../../db/repo";
import { type ApiRoute, HttpError, intParam, json, readJson } from "../router";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
} as const;

export const ingestRoutes: ApiRoute[] = [
  // Kick off an import (single video or whole playlist). Returns immediately;
  // progress is observed via the job + its SSE stream (B22).
  {
    method: "POST",
    path: "/api/v1/ingest/youtube",
    handler: async (ctx) => {
      const ingest = ctx.services.ingest;
      if (!ingest) throw new HttpError(503, "ingest_unavailable");
      const body = await readJson<{ url?: string; collectionId?: number }>(ctx.req);
      if (!body.url?.trim()) throw new HttpError(400, "url_required");
      const { job, done } = ingest.start(body.url.trim(), body.collectionId ?? undefined);
      // Run in the background; never block the request on the download.
      void done.catch((err) => console.error("[lark] ingest job failed", err));
      return json(job, 202);
    },
  },

  { method: "GET", path: "/api/v1/ingest/jobs", handler: (ctx) => json(repo.listDownloadJobs(ctx.db)) },

  {
    method: "GET",
    path: "/api/v1/ingest/jobs/:id",
    handler: (ctx) => {
      const id = intParam(ctx.params, "id");
      const job = repo.getDownloadJob(ctx.db, id);
      if (!job) throw new HttpError(404, "not_found");
      return json({ ...job, items: repo.listJobItems(ctx.db, id) });
    },
  },

  {
    method: "GET",
    path: "/api/v1/ingest/jobs/:id/events",
    handler: (ctx) => {
      const id = intParam(ctx.params, "id");
      const hub = ctx.services.hub;
      if (!hub) throw new HttpError(503, "events_unavailable");
      if (!repo.getDownloadJob(ctx.db, id)) throw new HttpError(404, "not_found");

      const encoder = new TextEncoder();
      let off: (() => void) | undefined;
      const db = ctx.db;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (frame: string) => {
            try {
              controller.enqueue(encoder.encode(frame));
            } catch {
              off?.();
            }
          };
          off = hub.subscribe(id, send);
          // Prime with the current snapshot so a late subscriber is in sync (B22).
          send(`data: ${JSON.stringify({ job: repo.getDownloadJob(db, id), items: repo.listJobItems(db, id) })}\n\n`);
        },
        cancel() {
          off?.();
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    },
  },
];
