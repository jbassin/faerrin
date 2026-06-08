import { test, expect, describe } from "bun:test";
import { bedFilter } from "./ffmpeg.ts";

describe("bedFilter", () => {
  test("loudnorms the speech only, keeps it at full level, and limits the sum", () => {
    const f = bedFilter({ path: "x", gain: 0.07, totalMs: 600_000 });
    // Speech (input 0) is the one that gets loudness-normalized.
    expect(f).toContain("[0:a]loudnorm");
    // amix must NOT normalize (else speech halves); a limiter catches the bed's peaks.
    expect(f).toContain("amix=inputs=2:duration=first:normalize=0");
    expect(f).toContain("alimiter");
    // Bed (input 1) is gained down and faded.
    expect(f).toContain("[1:a]");
    expect(f).toContain("volume=0.07");
    expect(f).toContain("afade=t=in:st=0:d=2");
  });

  test("times the bed fade-out to 3s before the episode end", () => {
    const f = bedFilter({ path: "x", gain: 0.1, totalMs: 600_000 });
    expect(f).toContain("afade=t=out:st=597.000:d=3");
  });

  test("clamps the fade-out start to 0 for very short episodes", () => {
    const f = bedFilter({ path: "x", gain: 0.1, totalMs: 1_000 });
    expect(f).toContain("afade=t=out:st=0.000:d=3");
  });
});
