import { rm } from "node:fs/promises";
import type { AudioManifest, Script, TtsClip, VoiceConfig } from "../types.ts";
import type { TTSProvider } from "./provider.ts";
import { MockTTSProvider } from "./mock.ts";
import { chunkTurns, DEFAULT_DIALOGUE_BUDGET } from "./dialogue.ts";
import { renderDelivery } from "./tags.ts";
import { DEFAULT_OUT_DIR, clipsDir, manifestPath, readManifest, writeManifest } from "./store.ts";

export type { SynthesisRequest, SynthesisResult, TTSProvider } from "./provider.ts";
export { MockTTSProvider } from "./mock.ts";
export { EdgeTTSProvider, DEFAULT_EDGE_VOICES, estimateMp3DurationMs } from "./edge.ts";
export {
  ElevenLabsTTSProvider,
  DEFAULT_ELEVENLABS_VOICES,
  DEFAULT_STABILITY,
  STABILITY_MODES,
  SEED_MAX,
  resolveStability,
  deriveSeed,
  parseSeedFlag,
} from "./elevenlabs.ts";
export { DEFAULT_OUT_DIR, clipsDir, manifestPath, readManifest, writeManifest } from "./store.ts";

/** Placeholder voice ids for the mock provider; real providers override these. */
export const DEFAULT_VOICES: VoiceConfig = {
  A: "mock-voice-a",
  B: "mock-voice-b",
  C: "mock-voice-c",
};

export interface SynthesizeOptions {
  provider?: TTSProvider;
  voices?: VoiceConfig;
  outDir?: string;
}

/** Zero-pad a turn index for stable, sortable clip filenames (e.g. 007). */
function clipName(index: number, format: string): string {
  return `${String(index).padStart(3, "0")}.${format}`;
}

/**
 * Stage 4: synthesize a script to audio clips and return a manifest. Dialogue-
 * capable backends (ElevenLabs v3) render runs of turns as pre-paced "dialogue"
 * chunks; everything else falls back to one clip per turn. Writes out/<id>/NNN.<fmt>.
 * The TTS backend sits behind `TTSProvider`; tests use the offline MockTTSProvider.
 */
export async function synthesizeScript(
  script: Script,
  options: SynthesizeOptions = {},
): Promise<AudioManifest> {
  const provider: TTSProvider = options.provider ?? new MockTTSProvider();
  const voices = options.voices ?? DEFAULT_VOICES;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const dir = clipsDir(script.sessionId, outDir);

  // Clear any prior clips so a shorter re-synth doesn't leave orphaned files
  // that could mislead Stage 5 (which trusts the manifest, but the dir too).
  await rm(dir, { recursive: true, force: true });

  const useDialogue = provider.dialogue === true && typeof provider.synthesizeDialogue === "function";
  const clips = useDialogue
    ? await synthesizeDialogueChunks(script, provider, voices, dir)
    : await synthesizePerTurn(script, provider, voices, dir);

  const manifest: AudioManifest = {
    sessionId: script.sessionId,
    mode: useDialogue ? "dialogue" : "turns",
    format: provider.format,
    voices,
    clips,
  };
  await writeManifest(manifest, outDir);
  return manifest;
}

/** One clip per turn, mapping speaker A/B to voices. */
async function synthesizePerTurn(
  script: Script,
  provider: TTSProvider,
  voices: VoiceConfig,
  dir: string,
): Promise<TtsClip[]> {
  const clips: TtsClip[] = [];
  for (let i = 0; i < script.turns.length; i++) {
    const turn = script.turns[i]!;
    const index = i + 1;
    const { audio, durationMs } = await provider.synthesize({
      text: turn.text,
      voice: voices[turn.speaker],
      emotion: turn.emotion,
    });
    const path = `${dir}/${clipName(index, provider.format)}`;
    await Bun.write(path, audio);
    clips.push({ index, speaker: turn.speaker, path, durationMs });
  }
  return clips;
}

/**
 * Group turns into per-request chunks (Text-to-Dialogue caps each call near
 * 2,000 chars) and synthesize each as one naturally-paced clip. The legacy
 * `emotion` hint is promoted to a leading v3 tag; inline tags pass through.
 */
async function synthesizeDialogueChunks(
  script: Script,
  provider: TTSProvider,
  voices: VoiceConfig,
  dir: string,
): Promise<TtsClip[]> {
  const render = (turn: Script["turns"][number]) => renderDelivery(turn.text, turn.emotion, true);
  const chunks = chunkTurns(script.turns, DEFAULT_DIALOGUE_BUDGET, (t) => render(t).length);

  const clips: TtsClip[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const inputs = chunk.map((t) => ({ text: render(t), voice: voices[t.speaker] }));
    const { audio, durationMs } = await provider.synthesizeDialogue!({ inputs });
    const index = i + 1;
    const path = `${dir}/${clipName(index, provider.format)}`;
    await Bun.write(path, audio);
    clips.push({ index, speaker: chunk[0]!.speaker, path, durationMs });
  }
  return clips;
}

/** True if every clip referenced by the manifest still exists on disk. */
async function clipsPresent(manifest: AudioManifest): Promise<boolean> {
  for (const clip of manifest.clips) {
    if (!(await Bun.file(clip.path).exists())) return false;
  }
  return true;
}

export interface LoadOrSynthesizeOptions extends SynthesizeOptions {
  force?: boolean;
}

export interface LoadOrSynthesizeResult {
  manifest: AudioManifest;
  cached: boolean;
  path: string;
}

/**
 * Return a session's audio, reusing the on-disk manifest when present (no
 * synthesis) and otherwise synthesizing + persisting — the seam between Stage 4
 * and Stage 5 (assembly).
 */
export async function loadOrSynthesize(
  script: Script,
  options: LoadOrSynthesizeOptions = {},
): Promise<LoadOrSynthesizeResult> {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const path = manifestPath(script.sessionId, outDir);

  if (!options.force) {
    const existing = await readManifest(script.sessionId, outDir);
    // Only a cache hit if the manifest's clips actually still exist on disk —
    // otherwise the manifest points at audio Stage 5 can't find.
    if (existing && (await clipsPresent(existing))) {
      return { manifest: existing, cached: true, path };
    }
  }

  const manifest = await synthesizeScript(script, options);
  return { manifest, cached: false, path };
}
