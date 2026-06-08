import type { HostConfig, Script, SpeakerId } from "../types.ts";
import type { LlmClient } from "@faerrin/llm";
import { scriptTool } from "./schema.ts";
import { parseScript, ScriptParseError } from "./parse.ts";
import { buildSharpenSystemPrompt, buildSharpenUserContent } from "./prompt.ts";

/** One focused pass per host, in order. */
const SHARPEN_ORDER: readonly SpeakerId[] = ["A", "B", "C"] as const;

/**
 * Phase 5 voice-sharpening: refine a finished script with one focused pass per host,
 * each pushing exactly that host's lines further into their archetype while copying
 * the rest verbatim. Done one host at a time (not in a single pass) so the model
 * can't re-average the three voices toward a shared mean. Returns the sharpened
 * Script (same shape, same turn count); uses only `callTool`, so any LlmClient works.
 */
export async function sharpenVoices(
  client: LlmClient,
  script: Script,
  hosts: HostConfig,
  model?: string,
  maxTokens?: number,
): Promise<Script> {
  let current = script;
  for (const target of SHARPEN_ORDER) {
    const raw = await client.callTool({
      system: buildSharpenSystemPrompt(hosts, target),
      userContent: buildSharpenUserContent(current),
      tool: scriptTool,
      model,
      maxTokens,
    });
    const next: Script = { ...parseScript(script.sessionId, raw), hosts };
    // A sharpen pass must only rewrite ONE host's lines, never drop/merge turns.
    // Compare to the ORIGINAL count so drift can't accumulate silently across passes;
    // fail loudly rather than quietly shrink a paid-for script.
    if (next.turns.length !== script.turns.length) {
      throw new ScriptParseError(
        `sharpen pass "${target}" changed the turn count ` +
          `(${script.turns.length} → ${next.turns.length}); discarding.`,
      );
    }
    current = next;
  }
  return current;
}
