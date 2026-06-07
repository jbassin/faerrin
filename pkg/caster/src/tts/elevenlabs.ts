import type { VoiceConfig } from "../types.ts";
import { estimateMp3DurationMs } from "./edge.ts";
import type {
  DialogueRequest,
  SynthesisRequest,
  SynthesisResult,
  TTSProvider,
} from "./provider.ts";
import { renderDelivery } from "./tags.ts";

/**
 * Default ElevenLabs voices for the three hosts. Reed (warm) / Quill (calm) /
 * Charlotte (bright, expressive). Override via synthesizeScript({ voices }) with
 * any voice id from your account.
 */
export const DEFAULT_ELEVENLABS_VOICES: VoiceConfig = {
  A: "EkK5I93UQWFDigLMpZcX", // Mark
  B: "aMSt68OGf4xUZAnLpTU8", // Juniper
  C: "exsUS4vynmxd379XN4yO", // Charlotte
};

/** mp3 44.1kHz @ 128 kbps → 16000 bytes/sec, for duration estimation. */
const OUTPUT_FORMAT = "mp3_44100_128";
const BYTES_PER_SECOND = 16000;

export interface ElevenLabsRequest {
  voiceId: string;
  text: string;
  modelId: string;
  outputFormat: string;
}

/** A multi-turn dialogue call: ordered (voiceId, text) inputs → one clip. */
export interface ElevenLabsDialogueRequest {
  inputs: { voiceId: string; text: string }[];
  modelId: string;
  outputFormat: string;
}

/** The network call, injectable so the provider is unit-tested with no live call. */
export type ElevenLabsFetch = (req: ElevenLabsRequest) => Promise<Uint8Array>;
/** The dialogue network call, injectable for the same reason. */
export type ElevenLabsDialogueFetch = (req: ElevenLabsDialogueRequest) => Promise<Uint8Array>;

function requireKey(): string {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set.");
  return apiKey;
}

const liveFetch: ElevenLabsFetch = async ({ voiceId, text, modelId, outputFormat }) => {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: { "xi-api-key": requireKey(), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: modelId }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

/** Text-to-Dialogue: one call returns a single clip with natural turn-taking. */
const liveDialogueFetch: ElevenLabsDialogueFetch = async ({ inputs, modelId, outputFormat }) => {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${outputFormat}`,
    {
      method: "POST",
      // Text-to-Dialogue returns application/octet-stream; output_format governs the
      // bytes, so don't constrain the response via Accept (avoids a strict-negotiation 406).
      headers: { "xi-api-key": requireKey(), "content-type": "application/json", accept: "*/*" },
      body: JSON.stringify({
        inputs: inputs.map((i) => ({ text: i.text, voice_id: i.voiceId })),
        model_id: modelId,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs dialogue ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

export interface ElevenLabsOptions {
  /** Model id; default eleven_v3 (expressive, supports audio tags + dialogue). */
  modelId?: string;
  /** Audio output format string; default mp3_44100_128. */
  outputFormat?: string;
  /** Keep inline v3 audio tags (and promote `emotion` to a leading tag). Default: on for v3. */
  audioTags?: boolean;
  /** Override the per-turn network call (tests). */
  fetcher?: ElevenLabsFetch;
  /** Override the dialogue network call (tests). */
  dialogueFetcher?: ElevenLabsDialogueFetch;
}

/**
 * ElevenLabs TTS provider. On eleven_v3 it prefers Text-to-Dialogue: a run of
 * turns is synthesized in one call with natural turn-taking, so Stage 5 just
 * concatenates chunks instead of stitching per-turn clips. Inline v3 audio tags
 * in the text drive delivery; on non-v3 models they're stripped to clean prose
 * and per-turn /v1/text-to-speech is used. Needs ELEVENLABS_API_KEY (paid).
 */
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly format = "mp3";
  /** Dialogue (and audio tags) are a v3 capability. */
  readonly dialogue: boolean;
  private readonly modelId: string;
  private readonly outputFormat: string;
  private readonly audioTags: boolean;
  private readonly fetcher: ElevenLabsFetch;
  private readonly dialogueFetcher: ElevenLabsDialogueFetch;

  constructor(options: ElevenLabsOptions = {}) {
    this.modelId = options.modelId ?? "eleven_v3";
    this.outputFormat = options.outputFormat ?? OUTPUT_FORMAT;
    // Audio tags / dialogue only make sense on v3; on other models a "[tag]"
    // would be read aloud literally, so default them off unless forced on.
    this.audioTags = options.audioTags ?? this.modelId.startsWith("eleven_v3");
    this.dialogue = this.audioTags;
    this.fetcher = options.fetcher ?? liveFetch;
    this.dialogueFetcher = options.dialogueFetcher ?? liveDialogueFetch;
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const text = renderDelivery(req.text, req.emotion, this.audioTags);
    const audio = await this.fetcher({
      voiceId: req.voice,
      text,
      modelId: this.modelId,
      outputFormat: this.outputFormat,
    });
    if (audio.byteLength === 0) {
      throw new Error(`ElevenLabs returned no audio for voice "${req.voice}".`);
    }
    return { audio, durationMs: estimateMp3DurationMs(audio.byteLength, BYTES_PER_SECOND) };
  }

  async synthesizeDialogue(req: DialogueRequest): Promise<SynthesisResult> {
    const audio = await this.dialogueFetcher({
      inputs: req.inputs.map((i) => ({ voiceId: i.voice, text: i.text })),
      modelId: this.modelId,
      outputFormat: this.outputFormat,
    });
    if (audio.byteLength === 0) {
      throw new Error("ElevenLabs returned no audio for the dialogue chunk.");
    }
    return { audio, durationMs: estimateMp3DurationMs(audio.byteLength, BYTES_PER_SECOND) };
  }
}
