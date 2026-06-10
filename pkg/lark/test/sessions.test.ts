import { describe, expect, test } from "bun:test";
import { clearCookie, parseCookies, sessionCookie, signSession, verifySession } from "../src/server/sessions";

const SECRET = "test-secret";

describe("session signing", () => {
  test("round-trips a valid session", () => {
    const token = signSession("user123", SECRET);
    const session = verifySession(token, SECRET);
    expect(session?.uid).toBe("user123");
  });

  test("rejects a tampered uid", () => {
    const token = signSession("user123", SECRET);
    const forged = token.replace("user123", "user999");
    expect(verifySession(forged, SECRET)).toBeNull();
  });

  test("rejects a wrong secret", () => {
    const token = signSession("user123", SECRET);
    expect(verifySession(token, "other-secret")).toBeNull();
  });

  test("rejects an expired session", () => {
    const now = Date.now();
    const token = signSession("user123", SECRET, 10, now);
    expect(verifySession(token, SECRET, now + 20_000)).toBeNull();
  });

  test("rejects malformed tokens", () => {
    expect(verifySession(undefined, SECRET)).toBeNull();
    expect(verifySession("a.b", SECRET)).toBeNull();
    expect(verifySession("garbage", SECRET)).toBeNull();
  });
});

describe("cookies", () => {
  test("sessionCookie sets HttpOnly + SameSite", () => {
    const c = sessionCookie("lark_session", "v");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
  });
  test("secure can be disabled for local http", () => {
    expect(sessionCookie("lark_session", "v", { secure: false })).not.toContain("Secure");
  });
  test("clearCookie expires immediately", () => {
    expect(clearCookie("lark_session")).toContain("Max-Age=0");
  });
  test("parseCookies handles multiple pairs", () => {
    expect(parseCookies("a=1; b=2; c=hello")).toEqual({ a: "1", b: "2", c: "hello" });
    expect(parseCookies(null)).toEqual({});
  });
});
