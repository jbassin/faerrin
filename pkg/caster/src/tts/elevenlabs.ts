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
 * Default ElevenLabs voices for the three hosts. Bram (warm, boisterous) /
 * Maeve (calm, grounded) / Pip (bright, quick). Override via
 * synthesizeScript({ voices }) with any voice id from your account.
 */
export const DEFAULT_ELEVENLABS_VOICES: VoiceConfig = {
  A: "UgBBYS2sOqTuMpoF3BR0", // Mark
  B: "BZgkqPqms7Kj9ulSkVzn", // Juniper
  C: "exsUS4vynmxd379XN4yO", // Charlotte
};

/**
 * Default to lossless PCM so Stage 5's loudnorm is the ONLY mp3 encode (fetching
 * mp3 here would mean two lossy generations). ElevenLabs PCM is headerless s16le
 * mono; we wrap it in a WAV container per clip (see pcmToWav). 24 kHz because
 * pcm_44100 is gated to the Pro tier and above — pcm_24000 is available more
 * broadly and is plenty for speech (loudnorm resamples to 44.1 kHz on encode).
 */
const OUTPUT_FORMAT = "pcm_24000";

/** Parsed properties of an ElevenLabs `output_format` string. */
export interface AudioFormatInfo {
  /** File container we write clips in: "wav" for PCM, "mp3" otherwise. */
  container: "wav" | "mp3";
  /** True when the API returns raw (headerless) PCM that we must wrap as WAV. */
  isPcm: boolean;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Bytes per second of the returned audio, for duration math. */
  bytesPerSecond: number;
}

/**
 * Parse an ElevenLabs `output_format` (e.g. "pcm_44100", "mp3_44100_128") into
 * container + duration parameters. ElevenLabs PCM is mono 16-bit; mp3 is
 * `mp3_<sampleRate>_<kbps>`.
 */
export function audioFormatInfo(outputFormat: string): AudioFormatInfo {
  if (outputFormat.startsWith("pcm_")) {
    const sampleRate = Number(outputFormat.slice(4)) || 44100;
    const channels = 1;
    const bitsPerSample = 16;
    return {
      container: "wav",
      isPcm: true,
      sampleRate,
      channels,
      bitsPerSample,
      bytesPerSecond: sampleRate * channels * (bitsPerSample / 8),
    };
  }
  // mp3_<sampleRate>_<kbps>
  const [, rate, kbps] = outputFormat.split("_");
  return {
    container: "mp3",
    isPcm: false,
    sampleRate: Number(rate) || 44100,
    channels: 1,
    bitsPerSample: 16,
    bytesPerSecond: ((Number(kbps) || 128) * 1000) / 8,
  };
}

/** Wrap raw PCM (s16le) in a 44-byte canonical WAV header so ffprobe/ffmpeg can read it. */
export function pcmToWav(
  pcm: Uint8Array,
  { sampleRate, channels, bitsPerSample }: Pick<AudioFormatInfo, "sampleRate" | "channels" | "bitsPerSample">,
): Uint8Array {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // file size minus the first 8 bytes
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/**
 * v3 stability named modes. Lower = broader emotional range and stronger
 * response to audio tags (but more drift); higher = flatter/more consistent.
 */
export const STABILITY_MODES = { creative: 0.0, natural: 0.5, robust: 1.0 } as const;
/** Default leans expressive (toward Creative) without full-Creative drift. */
export const DEFAULT_STABILITY = 0.3;
/** Seed is a uint32 on the ElevenLabs API. */
export const SEED_MAX = 4_294_967_295;

/**
 * Resolve a `--stability` value: a named mode (creative|natural|robust) or a raw
 * 0..1 float. Throws on anything else so a typo fails loudly instead of silently
 * sending a bad body.
 */
export function resolveStability(input: string | number): number {
  if (typeof input !== "number") {
    const key = input.trim().toLowerCase();
    if (key in STABILITY_MODES) return STABILITY_MODES[key as keyof typeof STABILITY_MODES];
  }
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`Invalid stability "${input}" — use creative|natural|robust or a number 0..1.`);
  }
  return n;
}

/** Deterministic uint32 seed from a session id (FNV-1a), so re-renders are stable. */
export function deriveSeed(sessionId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned 32-bit
}

/**
 * Resolve a `--seed` flag: undefined → derive from sessionId (reproducible),
 * "random" → a fresh uint32, otherwise a literal integer in [0, SEED_MAX].
 */
export function parseSeedFlag(value: string | undefined, sessionId: string): number {
  if (value === undefined) return deriveSeed(sessionId);
  if (value.trim().toLowerCase() === "random") return Math.floor(Math.random() * (SEED_MAX + 1));
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > SEED_MAX) {
    throw new Error(`Invalid seed "${value}" — use an integer 0..${SEED_MAX} or "random".`);
  }
  return n;
}

export interface ElevenLabsRequest {
  voiceId: string;
  text: string;
  modelId: string;
  outputFormat: string;
  /** v3 stability (0..1); omitted from the body when undefined. */
  stability?: number;
  /** Deterministic seed (uint32); omitted from the body when undefined. */
  seed?: number;
}

/** A multi-turn dialogue call: ordered (voiceId, text) inputs → one clip. */
export interface ElevenLabsDialogueRequest {
  inputs: { voiceId: string; text: string }[];
  modelId: string;
  outputFormat: string;
  /** v3 stability (0..1); omitted from the body when undefined. */
  stability?: number;
  /** Deterministic seed (uint32); omitted from the body when undefined. */
  seed?: number;
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

const liveFetch: ElevenLabsFetch = async ({ voiceId, text, modelId, outputFormat, stability, seed }) => {
  const body: Record<string, unknown> = { text, model_id: modelId };
  if (stability !== undefined) body.voice_settings = { stability };
  if (seed !== undefined) body.seed = seed;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: { "xi-api-key": requireKey(), "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

/** Text-to-Dialogue: one call returns a single clip with natural turn-taking. */
const liveDialogueFetch: ElevenLabsDialogueFetch = async ({
  inputs,
  modelId,
  outputFormat,
  stability,
  seed,
}) => {
  const body: Record<string, unknown> = {
    inputs: inputs.map((i) => ({ text: i.text, voice_id: i.voiceId })),
    model_id: modelId,
  };
  if (stability !== undefined) body.settings = { stability };
  if (seed !== undefined) body.seed = seed;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${outputFormat}`,
    {
      method: "POST",
      // Text-to-Dialogue returns application/octet-stream; output_format governs the
      // bytes, so don't constrain the response via Accept (avoids a strict-negotiation 406).
      headers: { "xi-api-key": requireKey(), "content-type": "application/json", accept: "*/*" },
      body: JSON.stringify(body),
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
  /** v3 stability (0..1). Omitted from the request body (API default) when unset. */
  stability?: number;
  /** Deterministic seed (uint32). Omitted from the request body when unset. */
  seed?: number;
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
  /** Clip container, derived from outputFormat ("wav" for PCM, "mp3" otherwise). */
  readonly format: string;
  /** Dialogue (and audio tags) are a v3 capability. */
  readonly dialogue: boolean;
  private readonly modelId: string;
  private readonly outputFormat: string;
  private readonly formatInfo: AudioFormatInfo;
  private readonly audioTags: boolean;
  private readonly stability?: number;
  private readonly seed?: number;
  private readonly fetcher: ElevenLabsFetch;
  private readonly dialogueFetcher: ElevenLabsDialogueFetch;

  constructor(options: ElevenLabsOptions = {}) {
    this.modelId = options.modelId ?? "eleven_v3";
    this.outputFormat = options.outputFormat ?? OUTPUT_FORMAT;
    this.formatInfo = audioFormatInfo(this.outputFormat);
    this.format = this.formatInfo.container;
    // Audio tags / dialogue only make sense on v3; on other models a "[tag]"
    // would be read aloud literally, so default them off unless forced on.
    this.audioTags = options.audioTags ?? this.modelId.startsWith("eleven_v3");
    this.dialogue = this.audioTags;
    this.stability = options.stability;
    this.seed = options.seed;
    this.fetcher = options.fetcher ?? liveFetch;
    this.dialogueFetcher = options.dialogueFetcher ?? liveDialogueFetch;
  }

  /**
   * Turn raw API bytes into a clip + duration. PCM is wrapped as WAV and its
   * duration is exact from the byte count; mp3 passes through with a byte-rate
   * estimate. Duration is always computed from the raw audio payload (pre-header).
   */
  private finalize(raw: Uint8Array): SynthesisResult {
    const durationMs = estimateMp3DurationMs(raw.byteLength, this.formatInfo.bytesPerSecond);
    const audio = this.formatInfo.isPcm ? pcmToWav(raw, this.formatInfo) : raw;
    return { audio, durationMs };
  }

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const text = renderDelivery(req.text, req.emotion, this.audioTags);
    const raw = await this.fetcher({
      voiceId: req.voice,
      text,
      modelId: this.modelId,
      outputFormat: this.outputFormat,
      stability: this.stability,
      seed: this.seed,
    });
    if (raw.byteLength === 0) {
      throw new Error(`ElevenLabs returned no audio for voice "${req.voice}".`);
    }
    return this.finalize(raw);
  }

  async synthesizeDialogue(req: DialogueRequest): Promise<SynthesisResult> {
    const raw = await this.dialogueFetcher({
      inputs: req.inputs.map((i) => ({ voiceId: i.voice, text: i.text })),
      modelId: this.modelId,
      outputFormat: this.outputFormat,
      stability: this.stability,
      seed: this.seed,
    });
    if (raw.byteLength === 0) {
      throw new Error("ElevenLabs returned no audio for the dialogue chunk.");
    }
    return this.finalize(raw);
  }
}
