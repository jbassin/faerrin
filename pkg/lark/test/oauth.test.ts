import { describe, expect, test } from "bun:test";
import { buildAuthorizeUrl, exchangeCodeForUser } from "../src/server/oauth";

const CFG = { clientId: "cid", clientSecret: "secret", redirectUri: "https://lark.test/auth/callback" };

describe("oauth", () => {
  test("builds an authorize URL with identify scope + state", () => {
    const url = new URL(buildAuthorizeUrl(CFG, "st8"));
    expect(url.origin + url.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  test("exchanges a code for the user via injected fetch", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string): Promise<Response> => {
      calls.push(input);
      if (input.includes("/token")) return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer" }));
      return new Response(JSON.stringify({ id: "9001", username: "dm" }));
    };
    const user = await exchangeCodeForUser(CFG, "the-code", fetchImpl);
    expect(user).toEqual({ id: "9001", username: "dm" });
    expect(calls[0]).toContain("/token");
    expect(calls[1]).toContain("/users/@me");
  });

  test("throws on a failed token exchange", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    await expect(exchangeCodeForUser(CFG, "bad", fetchImpl)).rejects.toThrow(/token exchange failed/);
  });
});
