import Anthropic from '@anthropic-ai/sdk';
import { AnthropicClient, type SystemBlock } from '@faerrin/llm';
import type { ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { config } from './config';
import { recordLLMCall } from './log';

export interface CompleteArgs<S extends ZodTypeAny | undefined = undefined> {
  stage: string;
  transcript?: string;
  page?: string;
  model: string;
  system?: string;
  cached?: string;
  user: string;
  schema?: S;
  maxTokens?: number;
}

export type CompleteResult<S extends ZodTypeAny | undefined> = {
  text: string;
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number; ms: number };
  value: S extends ZodTypeAny ? z.infer<S> : undefined;
};

let _client: AnthropicClient | null = null;
function client(): AnthropicClient {
  if (!_client) _client = new AnthropicClient(new Anthropic({ apiKey: config().ANTHROPIC_API_KEY }));
  return _client;
}

const TOOL_NAME = 'emit_result';

// Thin wrapper over @faerrin/llm: builds the (optionally two-block, cached) system
// prompt, derives a forced tool from the Zod schema, records cost, and parses the
// result. The shared client owns the streaming SDK call; cost-logging + Zod stay here.
export async function complete<S extends ZodTypeAny | undefined = undefined>(
  args: CompleteArgs<S>,
): Promise<CompleteResult<S>> {
  const system: SystemBlock[] = [];
  if (args.system) system.push({ text: args.system });
  if (args.cached) system.push({ text: args.cached, cache: true });

  const tool = args.schema
    ? {
        name: TOOL_NAME,
        description: 'Return the structured result for this request.',
        input_schema: zodToJsonSchema(args.schema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      }
    : undefined;

  const started = performance.now();
  const resp = await client().message({
    model: args.model,
    maxTokens: args.maxTokens ?? 4096,
    temperature: 0,
    system: system.length ? system : undefined,
    userContent: args.user,
    tool,
  });
  const ms = Math.round(performance.now() - started);

  const usage = {
    input: resp.usage.inputTokens,
    cacheRead: resp.usage.cacheReadTokens,
    cacheWrite: resp.usage.cacheWriteTokens,
    output: resp.usage.outputTokens,
    ms,
  };

  await recordLLMCall({
    stage: args.stage,
    transcript: args.transcript,
    page: args.page,
    model: args.model,
    inputTokens: usage.input,
    cachedTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    outputTokens: usage.output,
    ms,
  });

  let value: unknown = resp.toolInput;
  if (args.schema) {
    if (value === undefined) {
      throw new Error(`LLM did not call ${TOOL_NAME}; stop_reason=${resp.stopReason}`);
    }
    value = args.schema.parse(value);
  }

  return { text: resp.text, usage, value: value as CompleteResult<S>['value'] };
}
