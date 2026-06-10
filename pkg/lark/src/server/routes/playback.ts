/**
 * Playback control API (plan §7). Session-guarded here; Phase 5 makes the same
 * routes reachable via Stream Deck API key. `ctx.session.uid` is the actor used
 * for follow-the-operator (D8) regardless of which auth path set it.
 */
import * as repo from "../../db/repo";
import type { PlaybackEngine } from "../../bot/playback";
import { type ApiCtx, type ApiRoute, HttpError, json, readJson } from "../router";

function engineOf(ctx: ApiCtx): PlaybackEngine {
  const e = ctx.services.playback;
  if (!e) throw new HttpError(503, "playback_unavailable");
  return e;
}

/** Resolve the trackId list for a play request from ids/track/collection/playlist. */
function resolveTrackIds(
  ctx: ApiCtx,
  body: { trackIds?: number[]; trackId?: number; collectionId?: number; playlistId?: number },
): number[] {
  if (Array.isArray(body.trackIds) && body.trackIds.length) return body.trackIds;
  if (body.trackId) return [body.trackId];
  if (body.collectionId) return repo.listTracks(ctx.db, { collectionId: body.collectionId, limit: 500 }).map((t) => t.id);
  if (body.playlistId) return repo.playlistTrackIds(ctx.db, body.playlistId);
  throw new HttpError(400, "trackIds_trackId_collectionId_or_playlistId_required");
}

export const playbackRoutes: ApiRoute[] = [
  { method: "GET", path: "/api/v1/playback/now", handler: (ctx) => json(engineOf(ctx).nowPlaying()) },

  // Diagnostic: confirms what the server sees for the calling operator — your
  // resolved uid, the configured guild, whether the bot is up, and which voice
  // channel (if any) it can resolve for you. Hit it in the browser while you're
  // sitting in a voice channel.
  {
    method: "GET",
    path: "/api/v1/voice/debug",
    handler: async (ctx) => {
      const engine = ctx.services.playback;
      return json({
        uid: ctx.session.uid,
        guildId: ctx.config.guildId || null,
        playbackAvailable: Boolean(engine),
        resolvedChannelId: engine ? await engine.whereIsOperator(ctx.session.uid) : null,
        now: engine ? engine.nowPlaying() : null,
      });
    },
  },

  {
    method: "POST",
    path: "/api/v1/playback/play",
    handler: async (ctx) => {
      const engine = engineOf(ctx);
      const body = await readJson<{
        trackIds?: number[];
        trackId?: number;
        collectionId?: number;
        playlistId?: number;
        channelId?: string;
      }>(ctx.req);
      const trackIds = resolveTrackIds(ctx, body);
      if (trackIds.length === 0) throw new HttpError(404, "no_tracks");
      return json(await engine.play({ trackIds, userId: ctx.session.uid, channelId: body.channelId }));
    },
  },

  { method: "POST", path: "/api/v1/playback/stop", handler: async (ctx) => json(await engineOf(ctx).stop()) },
  { method: "POST", path: "/api/v1/playback/pause", handler: async (ctx) => json(await engineOf(ctx).pause()) },
  { method: "POST", path: "/api/v1/playback/resume", handler: async (ctx) => json(await engineOf(ctx).resume()) },
  { method: "POST", path: "/api/v1/playback/next", handler: async (ctx) => json(await engineOf(ctx).next()) },
  { method: "POST", path: "/api/v1/playback/prev", handler: async (ctx) => json(await engineOf(ctx).prev()) },

  {
    method: "POST",
    path: "/api/v1/playback/loop",
    handler: async (ctx) => {
      const body = await readJson<{ mode?: "none" | "track" | "playlist" }>(ctx.req);
      if (!body.mode || !["none", "track", "playlist"].includes(body.mode)) throw new HttpError(400, "invalid_mode");
      return json(await engineOf(ctx).setLoop(body.mode));
    },
  },

  {
    method: "POST",
    path: "/api/v1/voice/join",
    handler: async (ctx) => {
      const body = await readJson<{ channelId?: string }>(ctx.req).catch(() => ({}) as { channelId?: string });
      await engineOf(ctx).join({ userId: ctx.session.uid, channelId: body.channelId });
      return json(engineOf(ctx).nowPlaying());
    },
  },
  { method: "POST", path: "/api/v1/voice/leave", handler: async (ctx) => json(await engineOf(ctx).leave()) },
];
