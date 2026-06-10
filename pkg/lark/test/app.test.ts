import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/lib/appconfig";
import { openDb } from "../src/db/index";
import { createApp } from "../src/server/app";
import { signSession, verifySession } from "../src/server/sessions";

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
  // A valid signed state token (stateless CSRF) for the test secret.
  const goodState = encodeURIComponent(signSession("nonce", SECRET, 600));

  test("login redirects to Discord with a signed state (no cookie needed)", async () => {
    const res = await makeApp().handle(get("/auth/login"));
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("discord.com/api/oauth2/authorize");
    const state = new URL(loc).searchParams.get("state");
    expect(state).toBeTruthy();
    // The state Discord echoes back must verify against our secret.
    expect(verifySession(state ?? undefined, SECRET)).not.toBeNull();
  });

  test("callback exchanges code, sets session, redirects home", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/token")) return new Response(JSON.stringify({ access_token: "t", token_type: "Bearer" }));
      return new Response(JSON.stringify({ id: "allowed-uid", username: "dm" }));
    };
    const app = makeApp(testConfig(), { fetchImpl });
    const res = await app.handle(get(`/auth/callback?code=c&state=${goodState}`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toContain("lark_session=");
  });

  test("callback rejects an unsigned/forged state", async () => {
    const res = await makeApp().handle(get("/auth/callback?code=c&state=garbage"));
    expect(res.status).toBe(400);
  });

  test("callback 403s a non-allowlisted user", async () => {
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.includes("/token")) return new Response(JSON.stringify({ access_token: "t", token_type: "Bearer" }));
      return new Response(JSON.stringify({ id: "intruder", username: "x" }));
    };
    const app = makeApp(testConfig(), { fetchImpl });
    const res = await app.handle(get(`/auth/callback?code=c&state=${goodState}`));
    expect(res.status).toBe(403);
  });
});
