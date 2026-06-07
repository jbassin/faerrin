import { test, expect, describe, afterEach } from "bun:test";
import type {
  ElevenLabsDialogueFetch,
  ElevenLabsDialogueRequest,
  ElevenLabsFetch,
  ElevenLabsRequest,
} from "./elevenlabs.ts";
import {
  DEFAULT_STABILITY,
  ElevenLabsTTSProvider,
  SEED_MAX,
  STABILITY_MODES,
  audioFormatInfo,
  deriveSeed,
  parseSeedFlag,
  pcmToWav,
  resolveStability,
} from "./elevenlabs.ts";

function spyFetch(bytes = [1, 2, 3, 4]): { fetcher: ElevenLabsFetch; calls: ElevenLabsRequest[] } {
  const calls: ElevenLabsRequest[] = [];
  const fetcher: ElevenLabsFetch = async (req) => {
    calls.push(req);
    return new Uint8Array(bytes);
  };
  return { fetcher, calls };
}

function spyDialogue(
  bytes = [1, 2, 3, 4],
): { dialogueFetcher: ElevenLabsDialogueFetch; calls: ElevenLabsDialogueRequest[] } {
  const calls: ElevenLabsDialogueRequest[] = [];
  const dialogueFetcher: ElevenLabsDialogueFetch = async (req) => {
    calls.push(req);
    return new Uint8Array(bytes);
  };
  return { dialogueFetcher, calls };
}

describe("ElevenLabsTTSProvider", () => {
  test("declares wav format by default (PCM), mp3 when an mp3 format is requested", () => {
    expect(new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher }).format).toBe("wav");
    expect(
      new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher, outputFormat: "mp3_44100_128" }).format,
    ).toBe("mp3");
  });

  test("mp3 format: passes bytes through and estimates duration at the bitrate", async () => {
    const { fetcher } = spyFetch(new Array(16000).fill(0));
    const { audio, durationMs } = await new ElevenLabsTTSProvider({
      fetcher,
      outputFormat: "mp3_44100_128", // 128 kbps → 16000 B/s
    }).synthesize({ text: "hello", voice: "v" });
    expect(audio.byteLength).toBe(16000);
    expect(durationMs).toBe(1000);
  });

  test("PCM format: wraps the clip as WAV and computes exact duration", async () => {
    // pcm_44100 mono s16le → 88200 B/s; 88200 bytes = exactly 1s.
    const { fetcher } = spyFetch(new Array(88200).fill(0));
    const { audio, durationMs } = await new ElevenLabsTTSProvider({
      fetcher,
      outputFormat: "pcm_44100",
    }).synthesize({
      text: "hello",
      voice: "v",
    });
    expect(audio.byteLength).toBe(88200 + 44); // 44-byte WAV header prepended
    expect(String.fromCharCode(...audio.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...audio.slice(8, 12))).toBe("WAVE");
    expect(durationMs).toBe(1000);
  });

  test("v3 + audioTags prepends the emotion as an audio tag", async () => {
    const { fetcher, calls } = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher }).synthesize({
      text: "Welcome back.",
      voice: "v",
      emotion: "warm",
    });
    expect(calls[0]?.text).toBe("[warm] Welcome back.");
    expect(calls[0]?.modelId).toBe("eleven_v3");
  });

  test("no tag when there's no emotion, or when audioTags is disabled", async () => {
    const a = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher: a.fetcher }).synthesize({ text: "Plain.", voice: "v" });
    expect(a.calls[0]?.text).toBe("Plain.");

    const b = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher: b.fetcher, audioTags: false }).synthesize({
      text: "Plain.",
      voice: "v",
      emotion: "warm",
    });
    expect(b.calls[0]?.text).toBe("Plain.");
  });

  test("audio tags default off for non-v3 models (would be spoken literally)", async () => {
    const v2 = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher: v2.fetcher, modelId: "eleven_multilingual_v2" }).synthesize({
      text: "Hello.",
      voice: "v",
      emotion: "warm",
    });
    expect(v2.calls[0]?.text).toBe("Hello."); // no [warm] tag on v2

    // ...but can be force-enabled.
    const forced = spyFetch();
    await new ElevenLabsTTSProvider({
      fetcher: forced.fetcher,
      modelId: "eleven_multilingual_v2",
      audioTags: true,
    }).synthesize({ text: "Hello.", voice: "v", emotion: "warm" });
    expect(forced.calls[0]?.text).toBe("[warm] Hello.");
  });

  test("passes voice id and output format through to the fetcher", async () => {
    const { fetcher, calls } = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher, outputFormat: "mp3_22050_32" }).synthesize({
      text: "x",
      voice: "voice-123",
    });
    expect(calls[0]?.voiceId).toBe("voice-123");
    expect(calls[0]?.outputFormat).toBe("mp3_22050_32");
  });

  test("v3 keeps inline audio tags in the text", async () => {
    const { fetcher, calls } = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher }).synthesize({
      text: "[whispers] Did you hear that?",
      voice: "v",
    });
    expect(calls[0]?.text).toBe("[whispers] Did you hear that?");
  });

  test("passes stability and seed through when set; omits them when unset", async () => {
    const set = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher: set.fetcher, stability: 0.3, seed: 42 }).synthesize({
      text: "x",
      voice: "v",
    });
    expect(set.calls[0]?.stability).toBe(0.3);
    expect(set.calls[0]?.seed).toBe(42);

    const unset = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher: unset.fetcher }).synthesize({ text: "x", voice: "v" });
    expect(unset.calls[0]?.stability).toBeUndefined();
    expect(unset.calls[0]?.seed).toBeUndefined();
  });

  test("non-v3 strips inline audio tags so they aren't read aloud", async () => {
    const { fetcher, calls } = spyFetch();
    await new ElevenLabsTTSProvider({ fetcher, modelId: "eleven_multilingual_v2" }).synthesize({
      text: "[warm] Hey there. [laughs]",
      voice: "v",
    });
    expect(calls[0]?.text).toBe("Hey there.");
  });

  test("throws on empty audio", async () => {
    const { fetcher } = spyFetch([]);
    await expect(
      new ElevenLabsTTSProvider({ fetcher }).synthesize({ text: "x", voice: "v" }),
    ).rejects.toThrow(/no audio/);
  });
});

describe("ElevenLabsTTSProvider dialogue", () => {
  test("v3 advertises the dialogue capability; non-v3 does not", () => {
    expect(new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher }).dialogue).toBe(true);
    expect(
      new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher, modelId: "eleven_multilingual_v2" })
        .dialogue,
    ).toBe(false);
  });

  test("maps inputs to (text, voice_id), passes the model, estimates duration", async () => {
    const { dialogueFetcher, calls } = spyDialogue(new Array(8000).fill(0));
    const { audio, durationMs } = await new ElevenLabsTTSProvider({
      fetcher: spyFetch().fetcher,
      dialogueFetcher,
      outputFormat: "mp3_44100_128", // 16000 B/s, so 8000 B = 500 ms; bytes pass through
    }).synthesizeDialogue({
      inputs: [
        { text: "[warm] Hey.", voice: "voiceA" },
        { text: "[dry] Hi.", voice: "voiceB" },
      ],
    });
    expect(calls[0]?.inputs).toEqual([
      { voiceId: "voiceA", text: "[warm] Hey." },
      { voiceId: "voiceB", text: "[dry] Hi." },
    ]);
    expect(calls[0]?.modelId).toBe("eleven_v3");
    expect(audio.byteLength).toBe(8000);
    expect(durationMs).toBe(500); // 8000 B / 16000 B/s
  });

  test("passes stability and seed through to the dialogue fetcher; omits when unset", async () => {
    const set = spyDialogue();
    await new ElevenLabsTTSProvider({
      fetcher: spyFetch().fetcher,
      dialogueFetcher: set.dialogueFetcher,
      stability: 0.3,
      seed: 7,
    }).synthesizeDialogue({ inputs: [{ text: "x", voice: "v" }] });
    expect(set.calls[0]?.stability).toBe(0.3);
    expect(set.calls[0]?.seed).toBe(7);

    const unset = spyDialogue();
    await new ElevenLabsTTSProvider({
      fetcher: spyFetch().fetcher,
      dialogueFetcher: unset.dialogueFetcher,
    }).synthesizeDialogue({ inputs: [{ text: "x", voice: "v" }] });
    expect(unset.calls[0]?.stability).toBeUndefined();
    expect(unset.calls[0]?.seed).toBeUndefined();
  });

  test("throws on empty dialogue audio", async () => {
    const { dialogueFetcher } = spyDialogue([]);
    await expect(
      new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher, dialogueFetcher }).synthesizeDialogue({
        inputs: [{ text: "x", voice: "v" }],
      }),
    ).rejects.toThrow(/no audio/);
  });
});

describe("resolveStability", () => {
  test("maps named modes", () => {
    expect(resolveStability("creative")).toBe(STABILITY_MODES.creative);
    expect(resolveStability("natural")).toBe(STABILITY_MODES.natural);
    expect(resolveStability("robust")).toBe(STABILITY_MODES.robust);
    expect(resolveStability("  Natural ")).toBe(0.5); // trimmed, case-insensitive
  });

  test("passes through valid 0..1 numbers (string or number)", () => {
    expect(resolveStability("0.3")).toBe(0.3);
    expect(resolveStability(DEFAULT_STABILITY)).toBe(0.3);
    expect(resolveStability(0)).toBe(0);
    expect(resolveStability(1)).toBe(1);
  });

  test("throws on out-of-range or garbage", () => {
    expect(() => resolveStability("-0.1")).toThrow(/stability/);
    expect(() => resolveStability("1.5")).toThrow(/stability/);
    expect(() => resolveStability("loud")).toThrow(/stability/);
  });
});

describe("seed helpers", () => {
  test("deriveSeed is deterministic and a uint32", () => {
    const a = deriveSeed("105.observatory-slipped");
    expect(a).toBe(deriveSeed("105.observatory-slipped"));
    expect(deriveSeed("other")).not.toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(SEED_MAX);
  });

  test("parseSeedFlag: undefined derives from session id", () => {
    expect(parseSeedFlag(undefined, "abc")).toBe(deriveSeed("abc"));
  });

  test("parseSeedFlag: 'random' is an in-range uint32", () => {
    const s = parseSeedFlag("random", "abc");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(SEED_MAX);
  });

  test("parseSeedFlag: literal integer passes through; bad values throw", () => {
    expect(parseSeedFlag("42", "abc")).toBe(42);
    expect(() => parseSeedFlag("-1", "abc")).toThrow(/seed/);
    expect(() => parseSeedFlag("1.5", "abc")).toThrow(/seed/);
    expect(() => parseSeedFlag("nope", "abc")).toThrow(/seed/);
  });
});

describe("audioFormatInfo", () => {
  test("parses PCM as a wav container with mono s16le params", () => {
    const info = audioFormatInfo("pcm_44100");
    expect(info.container).toBe("wav");
    expect(info.isPcm).toBe(true);
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.bytesPerSecond).toBe(88200); // 44100 * 1 * 2
  });

  test("parses mp3 sample rate + bitrate into bytes/sec", () => {
    const info = audioFormatInfo("mp3_44100_128");
    expect(info.container).toBe("mp3");
    expect(info.isPcm).toBe(false);
    expect(info.bytesPerSecond).toBe(16000); // 128 kbps / 8
  });
});

describe("pcmToWav", () => {
  test("prepends a 44-byte header with correct fields", () => {
    const pcm = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const wav = pcmToWav(pcm, { sampleRate: 44100, channels: 1, bitsPerSample: 16 });
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength); // RIFF chunk size
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...wav.slice(12, 16))).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(24, true)).toBe(44100); // sample rate
    expect(view.getUint32(28, true)).toBe(88200); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(String.fromCharCode(...wav.slice(36, 40))).toBe("data");
    expect(view.getUint32(40, true)).toBe(pcm.byteLength); // data size
    expect([...wav.slice(44)]).toEqual([...pcm]); // payload preserved
  });
});

describe("ElevenLabsTTSProvider default fetcher", () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved;
  });

  test("errors clearly when no API key is set (no network call)", async () => {
    process.env.ELEVENLABS_API_KEY = "";
    await expect(
      new ElevenLabsTTSProvider().synthesize({ text: "x", voice: "v" }),
    ).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });
});
