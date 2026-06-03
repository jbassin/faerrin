import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Readable } from "node:stream";
import type { VoiceConfig } from "../types.ts";
import type { SynthesisRequest, SynthesisResult, TTSProvider } from "./provider.ts";
import { stripAudioTags } from "./tags.ts";

/**
 * Default Edge voices for the three hosts. Reed (warm recapper) / Quill (dry
 * lorekeeper) / Charlotte (bright instigator). Override via
 * synthesizeScript({ voices }). Any Edge ShortName works.
 */
export const DEFAULT_EDGE_VOICES: VoiceConfig = {
  A: "en-US-GuyNeural",
  B: "en-US-AriaNeural",
  C: "en-US-JennyNeural",
};

const OUTPUT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
/** 48 kbit/s CBR mono mp3 = 6000 bytes/sec. */
const BYTES_PER_SECOND = 6000;

/** Estimate clip duration from mp3 byte length at the known CBR bitrate. */
export function estimateMp3DurationMs(byteLength: number, bytesPerSecond = BYTES_PER_SECOND): number {
  return Math.round((byteLength / bytesPerSecond) * 1000);
}

/** Open an audio stream for one utterance. Injectable so tests avoid the network. */
export type EdgeSynth = (voice: string, text: string) => Promise<Readable>;

const liveSynth: EdgeSynth = async (voice, text) => {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT);
  const { audioStream } = tts.toStream(text);
  // Close the WebSocket once the audio has fully streamed.
  audioStream.once("end", () => tts.close());
  audioStream.once("error", () => tts.close());
  return audioStream;
};

async function collect(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Free Microsoft Edge TTS provider (via msedge-tts). No API key; needs network
 * at runtime. Real Neural voices, mp3 output. Edge doesn't understand v3 audio
 * tags, so inline "[tags]" are stripped to clean prose before synthesis (Edge
 * express-as styles need raw SSML and only some voices support them).
 */
export class EdgeTTSProvider implements TTSProvider {
  readonly format = "mp3";
  constructor(private readonly synth: EdgeSynth = liveSynth) {}

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const stream = await this.synth(req.voice, stripAudioTags(req.text));
    const audio = await collect(stream);
    if (audio.byteLength === 0) {
      throw new Error(`Edge TTS returned no audio for voice "${req.voice}".`);
    }
    return { audio, durationMs: estimateMp3DurationMs(audio.byteLength) };
  }
}
