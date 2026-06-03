import Anthropic from '@anthropic-ai/sdk';
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

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: config().ANTHROPIC_API_KEY });
  return _client;
}

const TOOL_NAME = 'emit_result';

export async function complete<S extends ZodTypeAny | undefined = undefined>(
  args: CompleteArgs<S>,
): Promise<CompleteResult<S>> {
  const systemBlocks: Anthropic.TextBlockParam[] = [];
  if (args.system) systemBlocks.push({ type: 'text', text: args.system });
  if (args.cached) {
    systemBlocks.push({ type: 'text', text: args.cached, cache_control: { type: 'ephemeral' } });
  }

  const tools: Anthropic.Tool[] | undefined = args.schema
    ? [{
        name: TOOL_NAME,
        description: 'Return the structured result for this request.',
        input_schema: zodToJsonSchema(args.schema, { target: 'jsonSchema7' }) as Anthropic.Tool['input_schema'],
      }]
    : undefined;

  const tool_choice: Anthropic.ToolChoice | undefined = args.schema
    ? { type: 'tool', name: TOOL_NAME }
    : undefined;

  const started = performance.now();
  const resp = await client().messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 4096,
    temperature: 0,
    system: systemBlocks.length ? systemBlocks : undefined,
    messages: [{ role: 'user', content: args.user }],
    tools,
    tool_choice,
  });
  const ms = Math.round(performance.now() - started);

  const usage = {
    input: resp.usage.input_tokens,
    cacheRead: resp.usage.cache_read_input_tokens ?? 0,
    cacheWrite: resp.usage.cache_creation_input_tokens ?? 0,
    output: resp.usage.output_tokens,
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

  let text = '';
  let value: unknown = undefined;
  for (const block of resp.content) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use' && block.name === TOOL_NAME) value = block.input;
  }

  if (args.schema) {
    if (value === undefined) {
      throw new Error(`LLM did not call ${TOOL_NAME}; stop_reason=${resp.stop_reason}`);
    }
    value = args.schema.parse(value);
  }

  return { text, usage, value: value as CompleteResult<S>['value'] };
}
