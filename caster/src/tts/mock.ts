import type { SynthesisRequest, SynthesisResult, TTSProvider } from "./provider.ts";
import { stripAudioTags } from "./tags.ts";

const SAMPLE_RATE = 8000; // mono 16-bit PCM

/** Rough spoken duration: ~165 wpm, floored so even short lines are audible. */
function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(60_000, Math.max(300, Math.round((words / 165) * 60_000)));
}

/** Encode `durationMs` of silence as a valid mono 16-bit PCM WAV. */
function silentWav(durationMs: number): Uint8Array {
  const samples = Math.round((SAMPLE_RATE * durationMs) / 1000);
  const dataBytes = samples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  // sample region left as zeros = silence
  return new Uint8Array(buf);
}

/**
 * Deterministic, offline TTS provider for tests and dry runs. Produces valid
 * silent WAV clips whose length tracks the text, so the rest of the pipeline
 * (and Stage 5 stitching) can run end-to-end without a network or API key.
 */
export class MockTTSProvider implements TTSProvider {
  readonly format = "wav";

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    // Estimate from the spoken words only — inline v3 tags aren't read aloud.
    const durationMs = estimateDurationMs(stripAudioTags(req.text));
    return { audio: silentWav(durationMs), durationMs };
  }
}
