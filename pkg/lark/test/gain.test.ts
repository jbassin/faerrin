import { describe, expect, test } from "bun:test";
import { buildAudioFilter, computeGainDb, dbToLinear } from "../src/bot/gain";

describe("computeGainDb (D5/B25)", () => {
  test("boosts quiet tracks toward target", () => {
    expect(computeGainDb(-20, { targetLufs: -16 })).toBe(4);
  });
  test("attenuates loud tracks", () => {
    expect(computeGainDb(-10, { targetLufs: -16 })).toBe(-6);
  });
  test("unity for unmeasured tracks", () => {
    expect(computeGainDb(null, { targetLufs: -16 })).toBe(0);
    expect(computeGainDb(undefined, { targetLufs: -16 })).toBe(0);
  });
  test("clamps boost and attenuation", () => {
    expect(computeGainDb(-99, { targetLufs: -16, maxBoostDb: 12 })).toBe(12);
    expect(computeGainDb(50, { targetLufs: -16, maxAttenuationDb: 30 })).toBe(-30);
  });
});

describe("buildAudioFilter", () => {
  test("includes a volume term + true-peak limiter when gaining", () => {
    const f = buildAudioFilter(4);
    expect(f).toContain("volume=4.00dB");
    expect(f).toContain("alimiter=limit=");
  });
  test("omits volume at unity but keeps the limiter", () => {
    const f = buildAudioFilter(0);
    expect(f).not.toContain("volume=");
    expect(f).toContain("alimiter");
  });
});

describe("dbToLinear", () => {
  test("0 dB is unity, -6 dB ≈ 0.5", () => {
    expect(dbToLinear(0)).toBeCloseTo(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 2);
  });
});
