import type { HostConfig, Script, SessionDigest, WikiCorpus } from "../types.ts";
import type { LlmClient } from "@faerrin/llm";
import { AnthropicClient } from "@faerrin/llm";
import type { GroundingEntry } from "./grounding.ts";
import { groundDigest } from "./grounding.ts";
import {
  buildScriptSystemPrompt,
  buildScriptUserContent,
  buildImprovSystemPrompt,
  buildDressingSystemPrompt,
  buildDressingUserContent,
} from "./prompt.ts";
import { scriptTool } from "./schema.ts";
import { parseScript } from "./parse.ts";
import { sharpenVoices } from "./sharpen.ts";
import type { Thread } from "./threads.ts";
import { formatThreads } from "./threads.ts";
import { DEFAULT_HOSTS } from "./hosts.ts";
import { DEFAULT_OUT_DIR, readScript, scriptPath, writeScript } from "./store.ts";

export type { GroundingEntry } from "./grounding.ts";
export { groundDigest } from "./grounding.ts";
export { ScriptParseError, parseScript } from "./parse.ts";
export { DEFAULT_HOSTS } from "./hosts.ts";
export { DEFAULT_OUT_DIR, scriptPath, readScript, writeScript } from "./store.ts";
export { computeMetrics, scoreScript, formatReport, words, THRESHOLDS } from "./lint.ts";
export type { LintMetrics, LintReport, CriterionScore } from "./lint.ts";
export { sharpenVoices } from "./sharpen.ts";
export {
  loadThreads,
  saveThreads,
  mergeThreads,
  formatThreads,
  extractThreads,
} from "./threads.ts";
export type { Thread, ThreadKind } from "./threads.ts";

/** A 30-40 minute episode is a large output; give the model ample room (streamed). */
export const DEFAULT_SCRIPT_MAX_TOKENS = 32_000;

export interface ScriptOptions {
  client?: LlmClient;
  model?: string;
  maxTokens?: number;
  /** Host names/personas (changes the system prompt; default Bram/Maeve/Pip). */
  hosts?: HostConfig;
  /**
   * Two-pass generation: a free-text "raw transcript" improv pass (Pass A) then a
   * protective "dressing" pass that structures it without polishing (Pass B). Removes
   * the one-shot global-lookahead that flattens the conversation into a podcast.
   * Requires a client with `callText` (free-text). Default false (one-shot).
   */
  twoPass?: boolean;
  /**
   * After generating, run a focused voice-sharpening pass per host (Phase 5) to push
   * each voice further from the mean. Adds three LLM calls; default false.
   */
  sharpen?: boolean;
  /**
   * Cross-session running threads (inside jokes, grudges, predictions) to inject so
   * the hosts can call back to them unexplained. Loaded from the store by the CLI.
   */
  threads?: Thread[];
}

/**
 * Stage 3: generate a two-host script from a session digest, grounding proper
 * nouns against the wiki. The LLM call sits behind `LlmClient`; pass a stub in tests.
 * The resulting Script records the hosts used.
 */
export async function generateScript(
  digest: SessionDigest,
  wiki: WikiCorpus,
  options: ScriptOptions = {},
): Promise<Script> {
  const client = options.client ?? new AnthropicClient();
  const hosts = options.hosts ?? DEFAULT_HOSTS;
  const grounding = groundDigest(digest, wiki);
  const maxTokens = options.maxTokens ?? DEFAULT_SCRIPT_MAX_TOKENS;
  const threadsBlock = formatThreads(options.threads ?? []);

  const base = options.twoPass
    ? await generateTwoPass(client, digest, grounding, hosts, options.model, maxTokens, threadsBlock)
    : parseScript(
        digest.sessionId,
        await client.callTool({
          system: buildScriptSystemPrompt(hosts),
          userContent: buildScriptUserContent(digest, grounding, threadsBlock),
          tool: scriptTool,
          model: options.model,
          maxTokens,
        }),
      );

  let script: Script = { ...base, hosts };
  if (options.sharpen) {
    script = await sharpenVoices(client, script, hosts, options.model, maxTokens);
  }
  return script;
}

/**
 * Two-pass generation. Pass A asks for a free-text raw transcript (no forced tool),
 * which keeps the model out of the clean-podcast attractor that one-shot structured
 * output falls into; Pass B records that transcript as structured turns + audio tags
 * without improving it. Both passes reuse the cacheable per-host system prompts.
 */
async function generateTwoPass(
  client: LlmClient,
  digest: SessionDigest,
  grounding: GroundingEntry[],
  hosts: HostConfig,
  model: string | undefined,
  maxTokens: number,
  threadsBlock: string,
): Promise<Script> {
  if (!client.callText) {
    throw new Error(
      "Two-pass script generation needs an LlmClient with free-text support (callText); " +
        "the provided client only supports callTool.",
    );
  }
  // Pass A — raw, imperfect plaintext transcript.
  const transcript = await client.callText({
    system: buildImprovSystemPrompt(hosts),
    userContent: buildScriptUserContent(digest, grounding, threadsBlock),
    model,
    maxTokens,
  });
  // Pass B — protective dressing into structured turns (no polishing).
  const raw = await client.callTool({
    system: buildDressingSystemPrompt(hosts),
    userContent: buildDressingUserContent(transcript),
    tool: scriptTool,
    model,
    maxTokens,
  });
  return parseScript(digest.sessionId, raw);
}

export interface LoadOrGenerateScriptOptions extends ScriptOptions {
  outDir?: string;
  force?: boolean;
}

export interface LoadOrGenerateScriptResult {
  script: Script;
  cached: boolean;
  path: string;
}

/**
 * Return a session's script, reusing the on-disk artifact when present (no LLM
 * call) and otherwise generating and persisting it — the disk-cached seam
 * between Stage 3 and Stage 4 (TTS).
 */
export async function loadOrGenerateScript(
  digest: SessionDigest,
  wiki: WikiCorpus,
  options: LoadOrGenerateScriptOptions = {},
): Promise<LoadOrGenerateScriptResult> {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const path = scriptPath(digest.sessionId, outDir);

  if (!options.force) {
    const existing = await readScript(digest.sessionId, outDir);
    if (existing) return { script: existing, cached: true, path };
  }

  const script = await generateScript(digest, wiki, options);
  await writeScript(script, outDir);
  return { script, cached: false, path };
}
