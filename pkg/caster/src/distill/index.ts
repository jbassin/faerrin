import type { Session, SessionDigest } from "../types.ts";
import type { LlmClient } from "../llm/client.ts";
import { AnthropicClient } from "../llm/client.ts";
import { DISTILL_SYSTEM_PROMPT, buildDistillUserContent } from "./prompt.ts";
import { distillTool } from "./schema.ts";
import { parseDigest } from "./parse.ts";
import { DEFAULT_OUT_DIR, digestPath, readDigest, writeDigest } from "./store.ts";

export type { LlmClient, ToolCallRequest } from "../llm/client.ts";
export { AnthropicClient, DEFAULT_MODEL } from "../llm/client.ts";
export { DigestParseError, parseDigest } from "./parse.ts";
export { DEFAULT_OUT_DIR, digestPath, readDigest, writeDigest } from "./store.ts";

export interface DistillOptions {
  client?: LlmClient;
  model?: string;
  maxTokens?: number;
}

/**
 * Stage 2: distill one session into a SessionDigest (filter table talk → ordered
 * story beats). The LLM call sits behind `LlmClient`; pass a stub in tests.
 */
export async function distillSession(
  session: Session,
  options: DistillOptions = {},
): Promise<SessionDigest> {
  const client = options.client ?? new AnthropicClient();

  const raw = await client.callTool({
    system: DISTILL_SYSTEM_PROMPT,
    userContent: buildDistillUserContent(session),
    tool: distillTool,
    model: options.model,
    maxTokens: options.maxTokens,
  });

  return parseDigest(session.id, raw);
}

export interface LoadOrDistillOptions extends DistillOptions {
  /** Artifact directory (default "out"). */
  outDir?: string;
  /** Re-distill and overwrite even if a cached artifact exists. */
  force?: boolean;
}

export interface LoadOrDistillResult {
  digest: SessionDigest;
  /** True when served from the on-disk artifact (no LLM call). */
  cached: boolean;
  /** Path to the artifact on disk. */
  path: string;
}

/**
 * Return a session's digest, reusing the on-disk artifact when present (no LLM
 * call) and otherwise distilling and persisting it. This is the disk-cached seam
 * between Stage 2 and Stage 3 — expensive Opus calls happen at most once per
 * session unless `force` is set.
 */
export async function loadOrDistill(
  session: Session,
  options: LoadOrDistillOptions = {},
): Promise<LoadOrDistillResult> {
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const path = digestPath(session.id, outDir);

  if (!options.force) {
    const existing = await readDigest(session.id, outDir);
    if (existing) return { digest: existing, cached: true, path };
  }

  const digest = await distillSession(session, options);
  await writeDigest(digest, outDir);
  return { digest, cached: false, path };
}
