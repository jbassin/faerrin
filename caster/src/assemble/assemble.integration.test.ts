import { test, expect, describe, afterAll } from "bun:test";
import { $ } from "bun";
import { rm } from "node:fs/promises";
import type { AudioManifest, Script } from "../types.ts";
import { MockTTSProvider } from "../tts/index.ts";
import { assembleEpisode, fadeClip, probeClip } from "./index.ts";

// Real ffmpeg integration; skipped if ffmpeg isn't on PATH.
const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

const TMP = `out/.test-assemble-${process.pid}`;
afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

function script(): Script {
  return {
    sessionId: "asm",
    title: "Test Episode",
    hosts: {
      A: { name: "Reed", persona: "" },
      B: { name: "Quill", persona: "" },
      C: { name: "Charlotte", persona: "" },
    },
    turns: [
      { speaker: "A", text: "First line." },
      { speaker: "B", text: "Second line." },
    ],
  };
}

describe.skipIf(!hasFfmpeg)("assembleEpisode (ffmpeg)", () => {
  test("stitches clips into a playable mp3 and writes a transcript", async () => {
    // Make two real (silent WAV) clips via the mock provider.
    const mock = new MockTTSProvider();
    const dir = `${TMP}/asm`;
    const clips = [];
    for (let i = 0; i < 2; i++) {
      const { audio, durationMs } = await mock.synthesize({ text: "a few words here", voice: "v" });
      const path = `${dir}/${String(i + 1).padStart(3, "0")}.wav`;
      await Bun.write(path, audio);
      clips.push({ index: i + 1, speaker: (i === 0 ? "A" : "B") as "A" | "B", path, durationMs });
    }
    const manifest: AudioManifest = {
      sessionId: "asm",
      format: "wav",
      voices: { A: "v", B: "v", C: "v" },
      clips,
    };

    const out = await assembleEpisode(manifest, script(), { outDir: TMP, rng: () => 0.5 });

    // Episode exists and ffprobe sees a positive audio duration.
    expect(await Bun.file(out.audioPath).exists()).toBe(true);
    const dur = await $`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 ${out.audioPath}`.text();
    expect(Number(dur.trim())).toBeGreaterThan(0);

    // Transcript written with host-labelled lines.
    expect(await Bun.file(out.transcriptPath).exists()).toBe(true);
    expect(await Bun.file(out.transcriptPath).text()).toContain("**Reed:** First line.");

    // Work dir cleaned up.
    expect(await Bun.file(`${TMP}/asm.assemble/concat.txt`).exists()).toBe(false);
  });

  test("dialogue mode concatenates chunks into a playable mp3", async () => {
    // Two "dialogue chunks" (silent WAV via the mock provider).
    const mock = new MockTTSProvider();
    const dir = `${TMP}/dlg`;
    const clips = [];
    for (let i = 0; i < 2; i++) {
      const { audio, durationMs } = await mock.synthesize({ text: "a chunk of dialogue here", voice: "v" });
      const path = `${dir}/${String(i + 1).padStart(3, "0")}.wav`;
      await Bun.write(path, audio);
      clips.push({ index: i + 1, speaker: "A" as const, path, durationMs });
    }
    const manifest: AudioManifest = {
      sessionId: "dlg",
      mode: "dialogue",
      format: "wav",
      voices: { A: "v", B: "v", C: "v" },
      clips,
    };

    const out = await assembleEpisode(manifest, script(), { outDir: TMP });
    expect(await Bun.file(out.audioPath).exists()).toBe(true);
    const dur = await $`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 ${out.audioPath}`.text();
    expect(Number(dur.trim())).toBeGreaterThan(0);
    expect(await Bun.file(`${TMP}/dlg.assemble/concat.txt`).exists()).toBe(false);
  });

  test("fadeClip drops the abrupt end of a clip below its body level", async () => {
    const dir = `${TMP}/fade`;
    await $`mkdir -p ${dir}`.quiet();
    // A full-scale 440Hz tone that ends abruptly (no natural decay) — the kind of
    // hard cut that clicks at a stitch boundary.
    const src = `${dir}/tone.mp3`;
    await $`ffmpeg -hide_banner -y -f lavfi -i sine=frequency=440:duration=1 -ac 1 -ar 44100 -c:a libmp3lame -b:a 128k ${src}`.quiet();

    const faded = `${dir}/tone-faded.mp3`;
    await fadeClip(src, faded, await probeClip(src), "mp3", 10, 80);

    const peak = async (path: string, sseof: string) => {
      // astats logs to stderr; -f null discards audio output.
      const { stderr } =
        await $`ffmpeg -hide_banner -sseof ${sseof} -i ${path} -af astats=measure_perchannel=none:measure_overall=Peak_level -f null -`.quiet();
      const out = stderr.toString();
      return Number(/Peak level dB:\s*(-?[0-9.]+)/.exec(out)?.[1] ?? "0");
    };
    // The last 60ms should now be far quieter than the last ~half-second body.
    const tail = await peak(faded, "-0.06");
    const body = await peak(faded, "-0.5");
    expect(tail).toBeLessThan(body - 20);
  });

  test("cleans the work dir even when assembly fails", async () => {
    const manifest: AudioManifest = {
      sessionId: "fail",
      format: "wav",
      voices: { A: "v", B: "v", C: "v" },
      clips: [{ index: 1, speaker: "A", path: `${TMP}/does-not-exist.wav`, durationMs: 100 }],
    };
    await expect(assembleEpisode(manifest, script(), { outDir: TMP })).rejects.toThrow();
    expect(await Bun.file(`${TMP}/fail.assemble/concat.txt`).exists()).toBe(false);
  });
});
