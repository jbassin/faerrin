import { describe, expect, test } from "bun:test";
import { validateRenderRequest, RENDER_LIMITS } from "./caps.ts";

describe("validateRenderRequest", () => {
  test("accepts a minimal request and defaults mode + scale", () => {
    const result = validateRenderRequest({ source: ":::item\nx\n:::" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe("mechanical");
      expect(result.value.scale).toBe(RENDER_LIMITS.defaultScale);
    }
  });

  test("rejects non-object and missing source", () => {
    expect(validateRenderRequest(null).ok).toBe(false);
    expect(validateRenderRequest("x").ok).toBe(false);
    expect(validateRenderRequest({}).ok).toBe(false);
  });

  test("rejects oversized source (SEC-4)", () => {
    const big = "x".repeat(RENDER_LIMITS.maxSourceBytes + 1);
    const result = validateRenderRequest({ source: big });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  test("rejects out-of-range scale (SEC-4 / R-16 cap)", () => {
    expect(validateRenderRequest({ source: "x", scale: 0 }).ok).toBe(false);
    expect(
      validateRenderRequest({ source: "x", scale: RENDER_LIMITS.maxScale + 1 })
        .ok,
    ).toBe(false);
    expect(validateRenderRequest({ source: "x", scale: 3 }).ok).toBe(true);
  });

  test("rejects unknown mode", () => {
    expect(validateRenderRequest({ source: "x", mode: "purple" }).ok).toBe(
      false,
    );
    expect(validateRenderRequest({ source: "x", mode: "diegetic" }).ok).toBe(
      true,
    );
  });
});
