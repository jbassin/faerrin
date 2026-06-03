import Anthropic from "@anthropic-ai/sdk";

/** Default model for LLM calls. Opus 4.8 — most capable; 1M context. */
export const DEFAULT_MODEL = "claude-opus-4-8";

/** Conservative streaming default; callers override for long outputs. */
export const DEFAULT_MAX_TOKENS = 16_000;

/** Token usage, normalized across calls (provider-neutral field names). */
export interface Usage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

/** A system-prompt block; `cache: true` marks it as an ephemeral cache breakpoint. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

/** A tool the model is forced to call: name, description, JSON Schema for input. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MessageRequest {
  /** Plain string → a single cached block; or explicit blocks for finer cache control. */
  system?: string | SystemBlock[];
  /** Per-call user content. */
  userContent: string;
  /** If set, the model is forced to call this tool (structured output). */
  tool?: ToolSpec;
  model?: string;
  maxTokens?: number;
  /** Defaults to 0. */
  temperature?: number;
}

export interface MessageResult {
  /** Concatenated text blocks (empty when a tool is forced). */
  text: string;
  /** The forced tool's `input`, or undefined if no tool / the model didn't call it. */
  toolInput: unknown;
  usage: Usage;
  stopReason: string | null;
}

/** Caster-compatible request: a forced tool with a single cached system prompt. */
export interface ToolCallRequest {
  system: string;
  userContent: string;
  tool: ToolSpec;
  model?: string;
  maxTokens?: number;
}

/**
 * Minimal, provider-agnostic seam: force a tool, return its `input`. Tests use a
 * hand-written stub implementing this interface — no live call.
 */
export interface LlmClient {
  callTool(req: ToolCallRequest): Promise<unknown>;
}

function toSystemParam(system: string | SystemBlock[]): Anthropic.TextBlockParam[] {
  const blocks: SystemBlock[] = typeof system === "string" ? [{ text: system, cache: true }] : system;
  return blocks.map((b) => ({
    type: "text",
    text: b.text,
    ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

function extractUsage(usage: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

/**
 * Anthropic-backed client.
 *
 * - Streams the response and uses `.finalMessage()` to avoid HTTP timeouts on
 *   large outputs.
 * - When a tool is forced, sets `tool_choice` to that tool for guaranteed
 *   structured output, and fails loudly if the output hits `max_tokens` (a
 *   forced tool call truncated mid-JSON yields invalid input).
 * - System blocks marked `cache: true` get an ephemeral `cache_control` breakpoint.
 *   NOTE: Opus 4.8's minimum cacheable prefix is ~4096 tokens; below that the API
 *   silently won't cache. Verify via `usage.cacheReadTokens`.
 */
export class AnthropicClient implements LlmClient {
  constructor(private readonly anthropic: Anthropic = new Anthropic()) {}

  async message(req: MessageRequest): Promise<MessageResult> {
    const stream = this.anthropic.messages.stream({
      model: req.model ?? DEFAULT_MODEL,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: req.temperature ?? 0,
      ...(req.system ? { system: toSystemParam(req.system) } : {}),
      ...(req.tool
        ? {
            tools: [
              {
                name: req.tool.name,
                description: req.tool.description,
                input_schema: req.tool.input_schema as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: { type: "tool" as const, name: req.tool.name },
          }
        : {}),
      messages: [{ role: "user", content: req.userContent }],
    });

    const message = await stream.finalMessage();

    if (req.tool && message.stop_reason === "max_tokens") {
      throw new Error(
        `Tool-call output hit max_tokens (${req.maxTokens ?? DEFAULT_MAX_TOKENS}); ` +
          `the result is truncated. Re-run with a higher maxTokens.`,
      );
    }

    let text = "";
    let toolInput: unknown = undefined;
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use" && block.name === req.tool?.name) toolInput = block.input;
    }

    return { text, toolInput, usage: extractUsage(message.usage), stopReason: message.stop_reason };
  }

  async callTool(req: ToolCallRequest): Promise<unknown> {
    const result = await this.message({
      system: req.system,
      userContent: req.userContent,
      tool: req.tool,
      model: req.model,
      maxTokens: req.maxTokens,
    });
    if (result.toolInput === undefined) {
      throw new Error(
        `Model did not call the forced tool "${req.tool.name}" (stop_reason: ${result.stopReason}).`,
      );
    }
    return result.toolInput;
  }
}
