import { test, expect, describe } from "bun:test";
import { Readable } from "node:stream";
import { EdgeTTSProvider, estimateMp3DurationMs } from "./edge.ts";

describe("estimateMp3DurationMs", () => {
  test("derives duration from byte length at 48 kbit/s (6000 B/s)", () => {
    expect(estimateMp3DurationMs(6000)).toBe(1000);
    expect(estimateMp3DurationMs(3000)).toBe(500);
    expect(estimateMp3DurationMs(0)).toBe(0);
  });
});

describe("EdgeTTSProvider", () => {
  test("declares mp3 format", () => {
    expect(new EdgeTTSProvider().format).toBe("mp3");
  });

  test("collects the audio stream and estimates duration (no network)", async () => {
    const fakeSynth = async () => Readable.from([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])]);
    const provider = new EdgeTTSProvider(fakeSynth);
    const { audio, durationMs } = await provider.synthesize({ text: "hi", voice: "en-US-GuyNeural" });
    expect([...audio]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(durationMs).toBe(estimateMp3DurationMs(6));
  });

  test("passes the requested voice and text to the synth function", async () => {
    let seen: { voice: string; text: string } | undefined;
    const fakeSynth = async (voice: string, text: string) => {
      seen = { voice, text };
      return Readable.from([Buffer.from([0])]);
    };
    await new EdgeTTSProvider(fakeSynth).synthesize({ text: "hello", voice: "en-US-AriaNeural" });
    expect(seen).toEqual({ voice: "en-US-AriaNeural", text: "hello" });
  });

  test("throws when the stream yields no audio", async () => {
    const fakeSynth = async () => Readable.from([]);
    await expect(
      new EdgeTTSProvider(fakeSynth).synthesize({ text: "x", voice: "v" }),
    ).rejects.toThrow(/no audio/);
  });
});
