import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/lib/appconfig";
import { openDb } from "../src/db/index";
import * as repo from "../src/db/repo";
import { type App, createApp } from "../src/server/app";
import { generateKey } from "../src/server/apikeys";
import { signSession } from "../src/server/sessions";

const SECRET = "test-secret";

function cfg(allow = ["uid"]): AppConfig {
  return {
    port: 0,
    sessionSecret: SECRET,
    allowlist: new Set(allow),
    oauth: { clientId: "c", clientSecret: "s", redirectUri: "x" },
    publicOrigin: "https://lark.test",
    secureCookies: true,
    distDir: "/nope",
    dataDir: "/tmp",
    dbPath: ":memory:",
    guildId: "g",
    targetLufs: -16,
  };
}

function makeApp(config = cfg()): App {
  return createApp(config, openDb(":memory:"), {});
}

const cookie = `lark_session=${signSession("uid", SECRET)}`;
const sreq = (m: string, p: string, b?: unknown) =>
  new Request(`https://lark.test${p}`, {
    method: m,
    headers: { cookie, ...(b ? { "content-type": "application/json" } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });

describe("key management (session-only, B26)", () => {
  test("create returns the raw key once; list never exposes it", async () => {
    const app = makeApp();
    const created = await (await app.handle(sreq("POST", "/api/v1/keys", { name: "Deck" }))).json();
    expect(created.key).toMatch(/^lark_/);
    expect(created.name).toBe("Deck");

    const list = await (await app.handle(sreq("GET", "/api/v1/keys"))).json();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBeUndefined();
    expect(list[0].prefix).toBe(created.prefix);
  });

  test("revoke removes a key from use", async () => {
    const app = makeApp();
    const created = await (await app.handle(sreq("POST", "/api/v1/keys", {}))).json();
    const res = await app.handle(sreq("DELETE", `/api/v1/keys/${created.id}`));
    expect(res.status).toBe(204);
    const list = await (await app.handle(sreq("GET", "/api/v1/keys"))).json();
    expect(list[0].revoked).toBe(true);
  });
});

describe("API-key authentication on /api", () => {
  function withKey(app: App): { raw: string } {
    const gen = generateKey();
    repo.createApiKey(app.db, { userId: "uid", name: "Deck", keyHash: gen.hash, keyPrefix: gen.prefix });
    return { raw: gen.raw };
  }
  const keyReq = (raw: string, p: string) =>
    new Request(`https://lark.test${p}`, { headers: { authorization: `Bearer ${raw}` } });

  test("a valid key authorizes a data route", async () => {
    const app = makeApp();
    const { raw } = withKey(app);
    const res = await app.handle(keyReq(raw, "/api/v1/collections"));
    expect(res.status).toBe(200);
  });

  test("a bad key is rejected", async () => {
    const app = makeApp();
    withKey(app);
    const res = await app.handle(keyReq("lark_bogus", "/api/v1/collections"));
    expect(res.status).toBe(401);
  });

  test("a revoked key is rejected", async () => {
    const app = makeApp();
    const gen = generateKey();
    const row = repo.createApiKey(app.db, { userId: "uid", name: "Deck", keyHash: gen.hash, keyPrefix: gen.prefix });
    repo.revokeApiKey(app.db, row.id, "uid");
    const res = await app.handle(keyReq(gen.raw, "/api/v1/collections"));
    expect(res.status).toBe(401);
  });

  test("a key whose owner is not allowlisted is rejected", async () => {
    const app = makeApp(cfg(["someone-else"]));
    const gen = generateKey();
    repo.createApiKey(app.db, { userId: "uid", name: "Deck", keyHash: gen.hash, keyPrefix: gen.prefix });
    const res = await app.handle(keyReq(gen.raw, "/api/v1/collections"));
    expect(res.status).toBe(401);
  });

  test("an API key cannot mint keys (management needs a session)", async () => {
    const app = makeApp();
    const { raw } = withKey(app);
    const res = await app.handle(
      new Request("https://lark.test/api/v1/keys", {
        method: "POST",
        headers: { authorization: `Bearer ${raw}`, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });

  test("key auth updates last_used_at", async () => {
    const app = makeApp();
    const { raw } = withKey(app);
    await app.handle(keyReq(raw, "/api/v1/collections"));
    const list = repo.listApiKeys(app.db, "uid");
    expect(list[0]!.last_used_at).not.toBeNull();
  });
});
