// Thin content-local wrapper over @faerrin/llm's AnthropicClient, mirroring
// heartwood's complete(): build an (optionally cached) system prompt, force a tool
// derived from a Zod schema for structured output, log cost, and return the parsed
// value. Does NOT import heartwood. The API key is read from this package's .env
// by the default AnthropicClient/Anthropic constructor (no key plumbing here).

import { AnthropicClient, costUSD, type SystemBlock } from "@faerrin/llm"
import type { z, ZodTypeAny } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { log } from "./log"

let _client: AnthropicClient | null = null
function client(): AnthropicClient {
  if (!_client) _client = new AnthropicClient()
  return _client
}

const TOOL_NAME = "emit_result"

export interface CompleteArgs<S extends ZodTypeAny> {
  /** Label for cost logging. */
  stage: string
  model: string
  /** Volatile instructions (not cached). */
  system?: string
  /** Stable prefix marked as an ephemeral cache breakpoint (the lexicon block). */
  cached?: string
  user: string
  schema: S
  maxTokens?: number
}

export interface CompleteResult<S extends ZodTypeAny> {
  value: z.infer<S>
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number; costUSD: number }
}

export async function complete<S extends ZodTypeAny>(args: CompleteArgs<S>): Promise<CompleteResult<S>> {
  const system: SystemBlock[] = []
  if (args.system) system.push({ text: args.system })
  if (args.cached) system.push({ text: args.cached, cache: true })

  const tool = {
    name: TOOL_NAME,
    description: "Return the structured result for this request.",
    input_schema: zodToJsonSchema(args.schema, { target: "jsonSchema7" }) as Record<string, unknown>,
  }

  const resp = await client().message({
    model: args.model,
    maxTokens: args.maxTokens ?? 4096,
    temperature: 0,
    system: system.length ? system : undefined,
    userContent: args.user,
    tool,
  })

  if (resp.toolInput === undefined) {
    throw new Error(`LLM did not call ${TOOL_NAME}; stop_reason=${resp.stopReason}`)
  }
  const value = args.schema.parse(resp.toolInput) as z.infer<S>

  const u = resp.usage
  const cost = costUSD(args.model, {
    input: u.inputTokens,
    cacheRead: u.cacheReadTokens,
    cacheWrite: u.cacheWriteTokens,
    output: u.outputTokens,
  })
  log.info(
    `[llm ${args.stage}] ${args.model} in=${u.inputTokens} cacheR=${u.cacheReadTokens} ` +
      `out=${u.outputTokens} $${cost.toFixed(4)}`,
  )

  return {
    value,
    usage: {
      input: u.inputTokens,
      cacheRead: u.cacheReadTokens,
      cacheWrite: u.cacheWriteTokens,
      output: u.outputTokens,
      costUSD: cost,
    },
  }
}
