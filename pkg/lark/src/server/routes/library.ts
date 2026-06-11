/**
 * Library CRUD + bulk ops API (plan §6 B11–B19, §7 web superset). All routes are
 * session-guarded (mounted behind the auth check in app.ts).
 */
import { unlink } from "node:fs/promises";
import { RenameError, previewBulkRename } from "../../lib/rename";
import type { RenameOp } from "../../lib/rename";
import * as repo from "../../db/repo";
import { handleUpload } from "../uploads";
import { type ApiCtx, type ApiRoute, HttpError, intParam, json, readJson } from "../router";

function trackWithTags(ctx: ApiCtx, track: repo.Track) {
  return { ...track, tags: repo.tagsForTrack(ctx.db, track.id) };
}

export const libraryRoutes: ApiRoute[] = [
  { method: "GET", path: "/api/v1/me", handler: (ctx) => json({ uid: ctx.session.uid }) },

  // --- Collections ---
  { method: "GET", path: "/api/v1/collections", handler: (ctx) => json(repo.listCollections(ctx.db)) },
  {
    method: "POST",
    path: "/api/v1/collections",
    handler: async (ctx) => {
      const body = await readJson<{ name?: string; ipOrGame?: string }>(ctx.req);
      if (!body.name?.trim()) throw new HttpError(400, "name_required");
      return json(repo.createCollection(ctx.db, { name: body.name.trim(), ipOrGame: body.ipOrGame ?? null }), 201);
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/collections/:id",
    handler: async (ctx) => {
      const id = intParam(ctx.params, "id");
      const body = await readJson<{ name?: string }>(ctx.req);
      if (!body.name?.trim()) throw new HttpError(400, "name_required");
      if (!repo.renameCollection(ctx.db, id, body.name.trim())) throw new HttpError(404, "not_found");
      return json(repo.getCollection(ctx.db, id));
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/collections/:id",
    handler: (ctx) => {
      if (!repo.deleteCollection(ctx.db, intParam(ctx.params, "id"))) throw new HttpError(404, "not_found");
      return new Response(null, { status: 204 });
    },
  },

  // --- Tracks ---
  {
    method: "GET",
    path: "/api/v1/tracks",
    handler: (ctx) => {
      const sp = ctx.url.searchParams;
      const page = Math.max(Number(sp.get("page") ?? "1"), 1);
      const limit = Math.min(Math.max(Number(sp.get("limit") ?? "200"), 1), 500);
      const tracks = repo.listTracks(ctx.db, {
        collectionId: sp.get("collection") ? Number(sp.get("collection")) : undefined,
        tagId: sp.get("tag") ? Number(sp.get("tag")) : undefined,
        q: sp.get("q") ?? undefined,
        limit,
        offset: (page - 1) * limit,
      });
      return json(tracks.map((t) => trackWithTags(ctx, t)));
    },
  },
  {
    method: "GET",
    path: "/api/v1/tracks/:id",
    handler: (ctx) => {
      const track = repo.getTrack(ctx.db, intParam(ctx.params, "id"));
      if (!track) throw new HttpError(404, "not_found");
      return json(trackWithTags(ctx, track));
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/tracks/:id",
    handler: async (ctx) => {
      const id = intParam(ctx.params, "id");
      const track = repo.getTrack(ctx.db, id);
      if (!track) throw new HttpError(404, "not_found");
      const body = await readJson<{ title?: string; collectionId?: number | null }>(ctx.req);
      if (body.title !== undefined) {
        if (!body.title.trim()) throw new HttpError(400, "title_required");
        repo.updateTrackTitle(ctx.db, id, body.title.trim());
      }
      if (body.collectionId !== undefined) repo.setTrackCollection(ctx.db, id, body.collectionId);
      return json(trackWithTags(ctx, repo.getTrack(ctx.db, id)!));
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/tracks/:id",
    handler: async (ctx) => {
      const removed = repo.deleteTrack(ctx.db, intParam(ctx.params, "id"));
      if (!removed) throw new HttpError(404, "not_found");
      if (removed.filePath) await unlink(removed.filePath).catch(() => {});
      return new Response(null, { status: 204 });
    },
  },

  // Move selected tracks into a collection (or out, with collectionId: null), B15.
  {
    method: "POST",
    path: "/api/v1/tracks/bulk-move",
    handler: async (ctx) => {
      const body = await readJson<{ ids?: number[]; collectionId?: number | null }>(ctx.req);
      if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, "ids_required");
      const collectionId = body.collectionId ?? null;
      if (collectionId !== null && !repo.getCollection(ctx.db, collectionId)) throw new HttpError(404, "collection_not_found");
      let moved = 0;
      for (const id of body.ids) moved += repo.setTrackCollection(ctx.db, id, collectionId) ? 1 : 0;
      return json({ moved });
    },
  },

  // Bulk delete (rows + underlying files), B18.
  {
    method: "POST",
    path: "/api/v1/tracks/bulk-delete",
    handler: async (ctx) => {
      const body = await readJson<{ ids?: number[] }>(ctx.req);
      if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, "ids_required");
      let deleted = 0;
      for (const id of body.ids) {
        const removed = repo.deleteTrack(ctx.db, id);
        if (removed) {
          deleted++;
          if (removed.filePath) await unlink(removed.filePath).catch(() => {});
        }
      }
      return json({ deleted });
    },
  },

  // --- Bulk rename (B13): preview or apply ---
  {
    method: "POST",
    path: "/api/v1/tracks/bulk-rename",
    handler: async (ctx) => {
      const body = await readJson<{ ids?: number[]; ops?: RenameOp[]; preview?: boolean }>(ctx.req);
      if (!Array.isArray(body.ids) || !Array.isArray(body.ops)) throw new HttpError(400, "ids_and_ops_required");
      const items = body.ids
        .map((id) => repo.getTrack(ctx.db, id))
        .filter((t): t is repo.Track => t !== null)
        .map((t) => ({ id: t.id, title: t.title }));
      let rows;
      try {
        rows = previewBulkRename(items, body.ops);
      } catch (err) {
        if (err instanceof RenameError) throw new HttpError(400, err.message);
        throw err;
      }
      if (body.preview) return json({ preview: rows });
      const applied = repo.bulkUpdateTitles(
        ctx.db,
        rows.filter((r) => r.changed).map((r) => ({ id: r.id, title: r.to })),
      );
      return json({ applied });
    },
  },

  // --- Bulk tag / untag (B14) ---
  {
    method: "POST",
    path: "/api/v1/tracks/bulk-tag",
    handler: async (ctx) => {
      const body = await readJson<{ ids?: number[]; addTags?: string[]; removeTagIds?: number[] }>(ctx.req);
      if (!Array.isArray(body.ids) || body.ids.length === 0) throw new HttpError(400, "ids_required");
      let added = 0;
      let removed = 0;
      if (body.addTags?.length) {
        const tagIds = body.addTags.map((name) => repo.upsertTag(ctx.db, name).id);
        added = repo.addTagsToTracks(ctx.db, body.ids, tagIds);
      }
      if (body.removeTagIds?.length) removed = repo.removeTagsFromTracks(ctx.db, body.ids, body.removeTagIds);
      return json({ added, removed });
    },
  },

  // --- Tags ---
  { method: "GET", path: "/api/v1/tags", handler: (ctx) => json(repo.listTags(ctx.db)) },
  {
    method: "POST",
    path: "/api/v1/tags",
    handler: async (ctx) => {
      const body = await readJson<{ name?: string; category?: string }>(ctx.req);
      if (!body.name?.trim()) throw new HttpError(400, "name_required");
      return json(repo.upsertTag(ctx.db, body.name, body.category ?? null), 201);
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/tags/:id",
    handler: async (ctx) => {
      const body = await readJson<{ name?: string; color?: string | null }>(ctx.req);
      if (body.name !== undefined && !body.name.trim()) throw new HttpError(400, "name_required");
      // color: null clears it; a string must be #rrggbb.
      if (body.color !== undefined && body.color !== null && !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        throw new HttpError(400, "invalid_color");
      }
      const updated = repo.updateTag(ctx.db, intParam(ctx.params, "id"), {
        name: body.name?.trim(),
        color: body.color,
      });
      if (!updated) throw new HttpError(404, "not_found");
      return json(updated);
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/tags/:id",
    handler: (ctx) => {
      if (!repo.deleteTag(ctx.db, intParam(ctx.params, "id"))) throw new HttpError(404, "not_found");
      return new Response(null, { status: 204 });
    },
  },

  // --- Playlists ---
  { method: "GET", path: "/api/v1/playlists", handler: (ctx) => json(repo.listPlaylists(ctx.db)) },
  {
    method: "POST",
    path: "/api/v1/playlists",
    handler: async (ctx) => {
      const body = await readJson<{ name?: string }>(ctx.req);
      if (!body.name?.trim()) throw new HttpError(400, "name_required");
      return json(repo.createPlaylist(ctx.db, body.name.trim()), 201);
    },
  },
  {
    method: "GET",
    path: "/api/v1/playlists/:id",
    handler: (ctx) => {
      const id = intParam(ctx.params, "id");
      const playlist = repo.getPlaylist(ctx.db, id);
      if (!playlist) throw new HttpError(404, "not_found");
      const trackIds = repo.playlistTrackIds(ctx.db, id);
      return json({ ...playlist, trackIds });
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/playlists/:id",
    handler: async (ctx) => {
      const id = intParam(ctx.params, "id");
      const body = await readJson<{ name?: string; loopMode?: "none" | "track" | "playlist"; shuffle?: boolean }>(
        ctx.req,
      );
      if (!repo.updatePlaylist(ctx.db, id, body) && !repo.getPlaylist(ctx.db, id)) throw new HttpError(404, "not_found");
      return json(repo.getPlaylist(ctx.db, id));
    },
  },
  {
    method: "PUT",
    path: "/api/v1/playlists/:id/items",
    handler: async (ctx) => {
      const id = intParam(ctx.params, "id");
      if (!repo.getPlaylist(ctx.db, id)) throw new HttpError(404, "not_found");
      const body = await readJson<{ trackIds?: number[] }>(ctx.req);
      if (!Array.isArray(body.trackIds)) throw new HttpError(400, "trackIds_required");
      repo.setPlaylistItems(ctx.db, id, body.trackIds);
      return json({ trackIds: repo.playlistTrackIds(ctx.db, id) });
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/playlists/:id",
    handler: (ctx) => {
      if (!repo.deletePlaylist(ctx.db, intParam(ctx.params, "id"))) throw new HttpError(404, "not_found");
      return new Response(null, { status: 204 });
    },
  },

  // --- Upload ingest (B19) ---
  {
    method: "POST",
    path: "/api/v1/ingest/upload",
    handler: async (ctx) => {
      let form: FormData;
      try {
        form = await ctx.req.formData();
      } catch {
        throw new HttpError(400, "expected_multipart");
      }
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (files.length === 0) throw new HttpError(400, "no_files");
      const collectionRaw = form.get("collectionId");
      const collectionId = collectionRaw ? Number(collectionRaw) : null;
      const result = await handleUpload({
        db: ctx.db,
        dataDir: ctx.config.dataDir,
        files,
        collectionId,
        prober: ctx.services.prober,
      });
      return json(result, 201);
    },
  },
];
