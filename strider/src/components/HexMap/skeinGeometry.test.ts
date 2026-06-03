import { describe, expect, it } from "vitest";
import {
  computeSkeinCurve,
  hashKey,
  partialCurvePolyline,
  samplePoint,
  skeinSignature,
} from "./skeinGeometry";

describe("hashKey", () => {
  it("is deterministic", () => {
    expect(hashKey("astris-lux|credence-floe")).toBe(
      hashKey("astris-lux|credence-floe"),
    );
  });

  it("differs for different inputs", () => {
    expect(hashKey("a|b")).not.toBe(hashKey("a|c"));
  });
});

describe("skeinSignature", () => {
  it("is deterministic for the same key", () => {
    const a = skeinSignature("foo|bar");
    const b = skeinSignature("foo|bar");
    expect(a).toEqual(b);
  });

  it("produces fields within documented ranges across many keys", () => {
    for (let i = 0; i < 200; i++) {
      const sig = skeinSignature(`node-${i}|other-${i * 7 + 3}`);
      expect(Math.abs(sig.bowFactor)).toBeGreaterThanOrEqual(0.06);
      expect(Math.abs(sig.bowFactor)).toBeLessThanOrEqual(0.12);
      expect(sig.phaseOffset).toBeGreaterThanOrEqual(0);
      expect(sig.phaseOffset).toBeLessThan(1);
      expect(sig.speedMul).toBeGreaterThanOrEqual(0.8);
      expect(sig.speedMul).toBeLessThanOrEqual(1.2);
      expect([3, 4, 5]).toContain(sig.beadCount);
      expect(sig.beadSpacing).toBeGreaterThanOrEqual(0.2);
      expect(sig.beadSpacing).toBeLessThanOrEqual(0.32);
      expect(sig.tailLen).toBeGreaterThanOrEqual(0.04);
      expect(sig.tailLen).toBeLessThanOrEqual(0.07);
    }
  });

  it("varies across keys", () => {
    const sigs = Array.from({ length: 50 }, (_, i) => skeinSignature(`k-${i}`));
    const distinctPhases = new Set(sigs.map((s) => s.phaseOffset.toFixed(6)));
    // Sanity: we shouldn't be collapsing to one value.
    expect(distinctPhases.size).toBeGreaterThan(40);
  });
});

describe("computeSkeinCurve", () => {
  const sig = skeinSignature("a|b");

  it("starts at endpoint A and ends at endpoint B", () => {
    const curve = computeSkeinCurve(10, 20, 30, 40, sig);
    expect(curve.samples[0][0]).toBeCloseTo(10);
    expect(curve.samples[0][1]).toBeCloseTo(20);
    const last = curve.samples[curve.samples.length - 1];
    expect(last[0]).toBeCloseTo(30);
    expect(last[1]).toBeCloseTo(40);
  });

  it("is deterministic for the same inputs", () => {
    const a = computeSkeinCurve(0, 0, 50, 0, sig);
    const b = computeSkeinCurve(0, 0, 50, 0, sig);
    expect(a.samples).toEqual(b.samples);
    expect(a.arcLength).toBe(b.arcLength);
  });

  it("produces a curve longer than the straight chord (bow > 0)", () => {
    const curve = computeSkeinCurve(0, 0, 50, 0, sig);
    expect(curve.arcLength).toBeGreaterThan(50);
  });

  it("handles degenerate (zero-length) endpoints without dividing by zero", () => {
    const curve = computeSkeinCurve(5, 5, 5, 5, sig);
    expect(curve.arcLength).toBe(0);
    expect(curve.samples.length).toBe(1);
    // Sampling should still return a finite point.
    const p = samplePoint(curve, 0.5);
    expect(p.x).toBe(5);
    expect(p.y).toBe(5);
    expect(Number.isFinite(p.tx)).toBe(true);
    expect(Number.isFinite(p.ty)).toBe(true);
  });
});

describe("samplePoint", () => {
  const sig = skeinSignature("c|d");

  it("returns endpoint A at t=0 and endpoint B at t=1", () => {
    const curve = computeSkeinCurve(2, 7, 22, -3, sig);
    const a = samplePoint(curve, 0);
    expect(a.x).toBeCloseTo(2);
    expect(a.y).toBeCloseTo(7);
    const b = samplePoint(curve, 1);
    expect(b.x).toBeCloseTo(22);
    expect(b.y).toBeCloseTo(-3);
  });

  it("returns a unit tangent", () => {
    const curve = computeSkeinCurve(0, 0, 100, 0, sig);
    const mid = samplePoint(curve, 0.5);
    expect(Math.hypot(mid.tx, mid.ty)).toBeCloseTo(1, 5);
  });
});

describe("partialCurvePolyline", () => {
  const sig = skeinSignature("e|f");
  const curve = computeSkeinCurve(0, 0, 60, 20, sig);

  it("returns just the start at t=0", () => {
    const pts = partialCurvePolyline(curve, 0);
    expect(pts).toEqual([curve.samples[0]]);
  });

  it("returns the full polyline at t=1", () => {
    const pts = partialCurvePolyline(curve, 1);
    expect(pts.length).toBe(curve.samples.length);
  });

  it("returns a sub-polyline of correct arc length at t=0.5", () => {
    const pts = partialCurvePolyline(curve, 0.5);
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      walked += Math.hypot(
        pts[i][0] - pts[i - 1][0],
        pts[i][1] - pts[i - 1][1],
      );
    }
    expect(walked).toBeCloseTo(0.5 * curve.arcLength, 4);
  });
});
