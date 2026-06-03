import { test, expect, describe, afterEach } from "bun:test";
import type {
  ElevenLabsDialogueFetch,
  ElevenLabsDialogueRequest,
  ElevenLabsFetch,
  ElevenLabsRequest,
} from "./elevenlabs.ts";
import { ElevenLabsTTSProvider } from "./elevenlabs.ts";

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
  test("declares mp3 format", () => {
    expect(new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher }).format).toBe("mp3");
  });

  test("collects audio and estimates duration at 128 kbps (16000 B/s)", async () => {
    const { fetcher } = spyFetch(new Array(16000).fill(0));
    const { audio, durationMs } = await new ElevenLabsTTSProvider({ fetcher }).synthesize({
      text: "hello",
      voice: "v",
    });
    expect(audio.byteLength).toBe(16000);
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

  test("throws on empty dialogue audio", async () => {
    const { dialogueFetcher } = spyDialogue([]);
    await expect(
      new ElevenLabsTTSProvider({ fetcher: spyFetch().fetcher, dialogueFetcher }).synthesizeDialogue({
        inputs: [{ text: "x", voice: "v" }],
      }),
    ).rejects.toThrow(/no audio/);
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
