import { test, expect, describe } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicClient, type ToolSpec } from "./client.ts";

// Inject a fake SDK so response handling is exercised with no network.
function fakeAnthropic(message: unknown): Anthropic {
  return {
    messages: {
      stream: () => ({ finalMessage: async () => message }),
    },
  } as unknown as Anthropic;
}

const tool: ToolSpec = {
  name: "record_thing",
  description: "record",
  input_schema: { type: "object", properties: {}, additionalProperties: true },
};

const req = { system: "sys", userContent: "content", tool };

describe("AnthropicClient.callTool", () => {
  test("returns the forced tool's input on a normal tool_use stop", async () => {
    const client = new AnthropicClient(
      fakeAnthropic({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: tool.name, input: { ok: true } }],
      }),
    );
    expect(await client.callTool(req)).toEqual({ ok: true });
  });

  test("throws an actionable error when output is truncated (max_tokens)", async () => {
    const client = new AnthropicClient(
      fakeAnthropic({
        stop_reason: "max_tokens",
        content: [{ type: "tool_use", name: tool.name, input: { partial: true } }],
      }),
    );
    await expect(client.callTool(req)).rejects.toThrow(/max_tokens/);
  });

  test("throws when the model didn't call the forced tool", async () => {
    const client = new AnthropicClient(
      fakeAnthropic({ stop_reason: "end_turn", content: [{ type: "text", text: "nope" }] }),
    );
    await expect(client.callTool(req)).rejects.toThrow(/did not call the forced tool/);
  });
});

describe("AnthropicClient.message", () => {
  test("returns text + usage for a plain (text-mode) completion", async () => {
    const client = new AnthropicClient(
      fakeAnthropic({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "hello world" }],
        usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 2 },
      }),
    );
    const r = await client.message({ system: "sys", userContent: "hi" });
    expect(r.text).toBe("hello world");
    expect(r.toolInput).toBeUndefined();
    expect(r.usage).toEqual({ inputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0, outputTokens: 3 });
    expect(r.stopReason).toBe("end_turn");
  });

  test("extracts tool input + does not throw on max_tokens when no tool is forced", async () => {
    const client = new AnthropicClient(
      fakeAnthropic({ stop_reason: "max_tokens", content: [{ type: "text", text: "partial" }] }),
    );
    const r = await client.message({ userContent: "hi" });
    expect(r.text).toBe("partial");
    expect(r.stopReason).toBe("max_tokens");
  });
});
