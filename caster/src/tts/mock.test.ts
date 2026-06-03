import { test, expect, describe } from "bun:test";
import { MockTTSProvider } from "./mock.ts";

const provider = new MockTTSProvider();

function ascii(bytes: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(off, off + len));
}

describe("MockTTSProvider", () => {
  test("declares wav format", () => {
    expect(provider.format).toBe("wav");
  });

  test("produces a valid RIFF/WAVE header with a matching data chunk size", async () => {
    const { audio } = await provider.synthesize({ text: "hello there friend", voice: "v" });
    expect(ascii(audio, 0, 4)).toBe("RIFF");
    expect(ascii(audio, 8, 4)).toBe("WAVE");
    expect(ascii(audio, 36, 4)).toBe("data");

    const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
    const dataBytes = view.getUint32(40, true);
    expect(audio.byteLength).toBe(44 + dataBytes);
    expect(view.getUint32(4, true)).toBe(36 + dataBytes); // RIFF chunk size
  });

  test("longer text yields a longer clip, with a floor", async () => {
    const short = await provider.synthesize({ text: "hi", voice: "v" });
    const long = await provider.synthesize({
      text: "this is a much longer line with a good number of words in it",
      voice: "v",
    });
    expect(long.durationMs).toBeGreaterThan(short.durationMs);
    expect(short.durationMs).toBeGreaterThanOrEqual(300);
  });
});
