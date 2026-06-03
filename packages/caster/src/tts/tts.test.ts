import { test, expect, describe, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import type { Script } from "../types.ts";
import type {
  DialogueRequest,
  SynthesisRequest,
  SynthesisResult,
  TTSProvider,
} from "./provider.ts";
import { loadOrSynthesize, synthesizeScript } from "./index.ts";

/** Records requests; returns 1-byte clips so we can assert wiring without WAV math. */
class SpyProvider implements TTSProvider {
  readonly format = "wav";
  requests: SynthesisRequest[] = [];
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    this.requests.push(req);
    return { audio: new Uint8Array([1]), durationMs: 1000 };
  }
}

/** Dialogue-capable spy: records each chunk's inputs, returns a 1-byte clip. */
class DialogueSpyProvider implements TTSProvider {
  readonly format = "mp3";
  readonly dialogue = true;
  perTurn = 0;
  chunks: DialogueRequest[] = [];
  async synthesize(): Promise<SynthesisResult> {
    this.perTurn++;
    return { audio: new Uint8Array([1]), durationMs: 1000 };
  }
  async synthesizeDialogue(req: DialogueRequest): Promise<SynthesisResult> {
    this.chunks.push(req);
    return { audio: new Uint8Array([1]), durationMs: 1000 };
  }
}

function script(): Script {
  return {
    sessionId: "105.observatory-slipped.2026-4-6",
    title: "The Slipped Observatory",
    hosts: {
      A: { name: "Reed", persona: "x" },
      B: { name: "Quill", persona: "y" },
      C: { name: "Charlotte", persona: "z" },
    },
    turns: [
      { speaker: "A", text: "Welcome to the Sedecium briefing.", emotion: "warm" },
      { speaker: "B", text: "Strap in." },
    ],
  };
}

const TMP = `out/.test-tts-${process.pid}`;
afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe("synthesizeScript", () => {
  test("maps voices, writes one clip per turn + a manifest", async () => {
    const spy = new SpyProvider();
    const manifest = await synthesizeScript(script(), {
      provider: spy,
      voices: { A: "voiceA", B: "voiceB", C: "voiceC" },
      outDir: TMP,
    });

    // Turn text reached the provider verbatim.
    expect(spy.requests[0]?.text).toBe("Welcome to the Sedecium briefing.");
    // Voice mapping + emotion pass-through.
    expect(spy.requests[0]?.voice).toBe("voiceA");
    expect(spy.requests[0]?.emotion).toBe("warm");
    expect(spy.requests[1]?.voice).toBe("voiceB");

    // Manifest + clip files.
    expect(manifest.clips).toHaveLength(2);
    expect(manifest.clips[0]?.path).toBe(`${TMP}/105.observatory-slipped.2026-4-6/001.wav`);
    expect(manifest.clips[1]?.speaker).toBe("B");
    for (const c of manifest.clips) {
      expect(await Bun.file(c.path).exists()).toBe(true);
    }
    expect(await Bun.file(`${TMP}/105.observatory-slipped.2026-4-6.audio.json`).exists()).toBe(true);
  });
});

describe("synthesizeScript dialogue mode", () => {
  test("uses the dialogue path, maps voices, promotes emotion to a v3 tag", async () => {
    const spy = new DialogueSpyProvider();
    const manifest = await synthesizeScript(script(), {
      provider: spy,
      voices: { A: "voiceA", B: "voiceB", C: "voiceC" },
      outDir: `${TMP}/dlg`,
    });

    expect(manifest.mode).toBe("dialogue");
    expect(spy.perTurn).toBe(0); // never fell back to per-turn synthesis
    // Two short turns fit one chunk → one clip, one dialogue request.
    expect(manifest.clips).toHaveLength(1);
    expect(manifest.clips[0]?.path).toBe(`${TMP}/dlg/105.observatory-slipped.2026-4-6/001.mp3`);
    expect(spy.chunks).toHaveLength(1);
    expect(spy.chunks[0]?.inputs).toEqual([
      { text: "[warm] Welcome to the Sedecium briefing.", voice: "voiceA" },
      { text: "Strap in.", voice: "voiceB" },
    ]);
  });
});

describe("synthesizeScript stale-clip cleanup", () => {
  test("clears prior clips so a shorter re-synth leaves no orphans", async () => {
    const dir = `${TMP}/stale`;
    const long = script(); // 2 turns
    await synthesizeScript(long, { provider: new SpyProvider(), outDir: dir });
    const clipDir = `${dir}/${long.sessionId}`;
    expect(await Bun.file(`${clipDir}/002.wav`).exists()).toBe(true);

    const short: Script = { ...long, turns: [long.turns[0]!] }; // 1 turn
    await synthesizeScript(short, { provider: new SpyProvider(), outDir: dir });
    expect(await Bun.file(`${clipDir}/001.wav`).exists()).toBe(true);
    expect(await Bun.file(`${clipDir}/002.wav`).exists()).toBe(false); // orphan removed
  });
});

describe("loadOrSynthesize caching", () => {
  test("synthesizes on a miss, then serves the manifest from disk on the next call", async () => {
    const spy = new SpyProvider();
    const first = await loadOrSynthesize(script(), { provider: spy, outDir: `${TMP}/c` });
    expect(first.cached).toBe(false);
    expect(spy.requests).toHaveLength(2);

    const second = await loadOrSynthesize(script(), { provider: spy, outDir: `${TMP}/c` });
    expect(second.cached).toBe(true);
    expect(spy.requests).toHaveLength(2); // no further synthesis
    expect(second.manifest).toEqual(first.manifest);
  });

  test("re-synthesizes when the manifest exists but its clips are gone", async () => {
    const dir = `${TMP}/missing`;
    const spy = new SpyProvider();
    const first = await loadOrSynthesize(script(), { provider: spy, outDir: dir });
    expect(first.cached).toBe(false);

    // Delete a clip the manifest references.
    await rm(first.manifest.clips[0]!.path, { force: true });

    const again = await loadOrSynthesize(script(), { provider: spy, outDir: dir });
    expect(again.cached).toBe(false); // not a hit — clips were missing
    expect(spy.requests).toHaveLength(4); // synthesized twice (2 + 2)
  });
});
