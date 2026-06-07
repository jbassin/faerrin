import type { HostConfig, Script, SessionDigest, WikiCorpus } from "../types.ts";
import type { LlmClient } from "@faerrin/llm";
import { AnthropicClient } from "@faerrin/llm";
import { groundDigest } from "./grounding.ts";
import { buildScriptSystemPrompt, buildScriptUserContent } from "./prompt.ts";
import { scriptTool } from "./schema.ts";
import { parseScript } from "./parse.ts";
import { DEFAULT_HOSTS } from "./hosts.ts";
import { DEFAULT_OUT_DIR, readScript, scriptPath, writeScript } from "./store.ts";

export type { GroundingEntry } from "./grounding.ts";
export { groundDigest } from "./grounding.ts";
export { ScriptParseError, parseScript } from "./parse.ts";
export { DEFAULT_HOSTS } from "./hosts.ts";
export { DEFAULT_OUT_DIR, scriptPath, readScript, writeScript } from "./store.ts";

/** A 30-40 minute episode is a large output; give the model ample room (streamed). */
export const DEFAULT_SCRIPT_MAX_TOKENS = 32_000;

export interface ScriptOptions {
  client?: LlmClient;
  model?: string;
  maxTokens?: number;
  /** Host names/personas (changes the system prompt; default Bram/Maeve/Pip). */
  hosts?: HostConfig;
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

  const raw = await client.callTool({
    system: buildScriptSystemPrompt(hosts),
    userContent: buildScriptUserContent(digest, grounding),
    tool: scriptTool,
    model: options.model,
    maxTokens: options.maxTokens ?? DEFAULT_SCRIPT_MAX_TOKENS,
  });

  const script = parseScript(digest.sessionId, raw);
  return { ...script, hosts };
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
