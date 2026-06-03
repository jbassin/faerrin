import Anthropic from "@anthropic-ai/sdk";

/** Default model for pipeline LLM calls. Opus 4.8 — most capable; 1M context. */
export const DEFAULT_MODEL = "claude-opus-4-8";

/** Conservative streaming default; callers override for long outputs (e.g. scripts). */
export const DEFAULT_MAX_TOKENS = 16_000;

/** A tool the model is forced to call: name, description, JSON Schema for input. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCallRequest {
  /** Static system prompt — the cacheable prefix shared across calls. */
  system: string;
  /** Per-call user content. */
  userContent: string;
  /** The tool the model is forced to call; we return its `input`. */
  tool: ToolSpec;
  model?: string;
  maxTokens?: number;
}

/**
 * Minimal, provider-agnostic seam: take a system prompt + user content + a forced
 * tool, return the tool's `input` object. Everything above this (prompt building,
 * schemas, parsing) is pure and testable; everything below is the network call.
 * Tests use a hand-written stub implementing this interface — no live call.
 */
export interface LlmClient {
  callTool(req: ToolCallRequest): Promise<unknown>;
}

/**
 * Anthropic-backed client.
 *
 * - Forces `tool_choice` to the single tool for guaranteed structured output.
 *   (Forcing a specific tool precludes adaptive thinking, so thinking is left off;
 *   the model + prompt carry the work. Deliberate tradeoff for reliable extraction.)
 * - Streams the response and uses `.finalMessage()` to avoid HTTP timeouts on
 *   large outputs.
 * - Marks the system prompt with `cache_control` so the static prefix is cached
 *   across calls. NOTE: Opus 4.8's minimum cacheable prefix is ~4096 tokens; if
 *   the system prompt + tool schema fall below that, the API silently won't cache
 *   (no error). Verify via `cache_read_input_tokens` in usage.
 */
export class AnthropicClient implements LlmClient {
  constructor(private readonly anthropic: Anthropic = new Anthropic()) {}

  async callTool(req: ToolCallRequest): Promise<unknown> {
    const stream = this.anthropic.messages.stream({
      model: req.model ?? DEFAULT_MODEL,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: req.tool.name,
          description: req.tool.description,
          input_schema: req.tool.input_schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: req.tool.name },
      messages: [{ role: "user", content: req.userContent }],
    });

    const message = await stream.finalMessage();

    // A forced tool call that hits the output cap yields a truncated (often
    // invalid) tool input. Fail loudly with an actionable message rather than
    // letting a downstream parser choke on half a JSON object.
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        `Tool-call output hit max_tokens (${req.maxTokens ?? DEFAULT_MAX_TOKENS}); ` +
          `the result is truncated. Re-run with a higher maxTokens.`,
      );
    }

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === req.tool.name,
    );
    if (!toolUse) {
      throw new Error(
        `Model did not call the forced tool "${req.tool.name}" (stop_reason: ${message.stop_reason}).`,
      );
    }
    return toolUse.input;
  }
}
