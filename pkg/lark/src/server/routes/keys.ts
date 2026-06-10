/**
 * Stream Deck API-key management (plan §7/B26). Bound to the logged-in user; the
 * raw key is returned only once at creation. These routes require a **web
 * session** — an API key cannot mint or revoke keys.
 */
import * as repo from "../../db/repo";
import { generateKey } from "../apikeys";
import { type ApiCtx, type ApiRoute, HttpError, intParam, json, readJson } from "../router";

function requireSession(ctx: ApiCtx): void {
  if (ctx.authMethod !== "session") throw new HttpError(403, "key_management_requires_login");
}

/** Public view of a key — never includes the hash. */
function publicKey(k: repo.ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.key_prefix,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    revoked: k.revoked_at !== null,
  };
}

export const keyRoutes: ApiRoute[] = [
  {
    method: "GET",
    path: "/api/v1/keys",
    handler: (ctx) => {
      requireSession(ctx);
      return json(repo.listApiKeys(ctx.db, ctx.session.uid).map(publicKey));
    },
  },
  {
    method: "POST",
    path: "/api/v1/keys",
    handler: async (ctx) => {
      requireSession(ctx);
      const body = await readJson<{ name?: string }>(ctx.req);
      const name = body.name?.trim() || "Stream Deck";
      const gen = generateKey();
      const stored = repo.createApiKey(ctx.db, {
        userId: ctx.session.uid,
        name,
        keyHash: gen.hash,
        keyPrefix: gen.prefix,
      });
      // The raw key is shown exactly once here and never retrievable again (B26).
      return json({ ...publicKey(stored), key: gen.raw }, 201);
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/keys/:id",
    handler: (ctx) => {
      requireSession(ctx);
      if (!repo.revokeApiKey(ctx.db, intParam(ctx.params, "id"), ctx.session.uid)) throw new HttpError(404, "not_found");
      return new Response(null, { status: 204 });
    },
  },
];
