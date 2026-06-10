import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/lib/appconfig";
import { openDb } from "../src/db/index";
import { createApp } from "../src/server/app";
import { signSession } from "../src/server/sessions";

const SECRET = "test-secret";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    sessionSecret: SECRET,
    allowlist: new Set(["allowed-uid"]),
    oauth: { clientId: "cid", clientSecret: "sec", redirectUri: "https://lark.test/auth/callback" },
    publicOrigin: "https://lark.test",
    secureCookies: true,
    distDir: "/nonexistent-dist",
    dataDir: "/tmp/lark-test",
    dbPath: ":memory:",
    guildId: "guild",
    targetLufs: -16,
    ...overrides,
  };
}

function makeApp(cfg = testConfig(), deps = {}) {
  return createApp(cfg, openDb(":memory:"), deps);
}

function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://lark.test${path}`, { headers });
}

describe("health + auth guard", () => {
  test("health is open", async () => {
    const res = await makeApp().handle(get("/api/v1/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("/api/v1/me is 401 without a session", async () => {
    const res = await makeApp().handle(get("/api/v1/me"));
    expect(res.status).toBe(401);
  });

  test("/api/v1/me returns uid for an allowlisted session", async () => {
    const token = signSession("allowed-uid", SECRET);
    const res = await makeApp().handle(get("/api/v1/me", { cookie: `lark_session=${token}` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "allowed-uid" });
  });

  test("/api/v1/me rejects a non-allowlisted session", async () => {
    const token = signSession("intruder", SECRET);
    const res = await makeApp().handle(get("/api/v1/me", { cookie: `lark_session=${token}` }));
    expect(res.status).toBe(401);
  });
});

describe("oauth login + callback", () => {
  test("login redirects to Discord and sets a state cookie", async () => {
    const app = makeApp(testConfig(), { makeState: () => "fixed-state" });
    const res = await app.handle(get("/auth/login"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("discord.com/api/oauth2/authorize");
    expect(res.headers.get("set-cookie")).toContain("lark_oauth_state=fixed-state");
  });

  test("callback exchanges code, sets session, redirects home", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/token")) return new Response(JSON.stringify({ access_token: "t", token_type: "Bearer" }));
      return new Response(JSON.stringify({ id: "allowed-uid", username: "dm" }));
    };
    const app = makeApp(testConfig(), { fetchImpl });
    const req = get("/auth/callback?code=c&state=s", { cookie: "lark_oauth_state=s" });
    const res = await app.handle(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("lark_session=");
  });

  test("callback rejects a mismatched state", async () => {
    const app = makeApp();
    const res = await app.handle(get("/auth/callback?code=c&state=s", { cookie: "lark_oauth_state=different" }));
    expect(res.status).toBe(400);
  });

  test("callback 403s a non-allowlisted user", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/token")) return new Response(JSON.stringify({ access_token: "t", token_type: "Bearer" }));
      return new Response(JSON.stringify({ id: "intruder", username: "x" }));
    };
    const app = makeApp(testConfig(), { fetchImpl });
    const res = await app.handle(get("/auth/callback?code=c&state=s", { cookie: "lark_oauth_state=s" }));
    expect(res.status).toBe(403);
  });
});
