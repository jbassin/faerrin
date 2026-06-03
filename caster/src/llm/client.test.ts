import { test, expect, describe } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicClient, type ToolSpec } from "./client.ts";

// Inject a fake SDK so callTool's response handling is exercised with no network.
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
