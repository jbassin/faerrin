# CLAUDE.md — `@faerrin/llm`

Guidance for **llm** (`@faerrin/llm`): the monorepo's **shared Anthropic client + pricing**.
It is the one place LLM calls are made — caster and heartwood depend on it; nothing else should call
the Anthropic SDK directly.

## What it exports (`src/index.ts`)

- **`AnthropicClient`** (`src/client.ts`) — a thin, provider-neutral wrapper over `@anthropic-ai/sdk`.
  Key shapes: `MessageRequest` (system as a plain string → one cached block, or explicit `SystemBlock[]`
  for finer cache control; optional forced `tool` for structured output; `temperature` defaults to 0),
  `MessageResult`, and a normalized `Usage` (`inputTokens` / `cacheReadTokens` / `cacheWriteTokens` /
  `outputTokens`).
- **`DEFAULT_MODEL`** = `claude-opus-4-8` (Opus 4.8), **`DEFAULT_MAX_TOKENS`** = 16,000.
- **`PRICING_USD_PER_1M` / `costUSD()`** (`src/pricing.ts`) — the USD-per-1M-token rate table and a
  cost helper; `ModelPricing` type.

## How it's consumed

This package is **imported** (a real workspace dependency `@faerrin/llm`, unlike the content data which
is referenced by path). Consumers wrap it rather than calling it raw:

- **heartwood** wraps it in `complete()` (`src/llm.ts`) — adds a Zod schema for typed structured output
  and per-call cost logging.
- **caster** calls it from its `distill` and `script` stages.

## Conventions

- Bun-first: `bun test`, `bun run typecheck`. No build step — consumers import `src/index.ts` directly
  (`"exports": { ".": "./src/index.ts" }`).
- **Keep it provider-neutral and dependency-light.** The field names are deliberately generic
  (`inputTokens`, not Anthropic's `input_tokens`) so a future provider swap stays contained here.
- **Pricing must track the models actually used.** When a consumer adopts a new model id, add its row
  to `PRICING_USD_PER_1M` or cost logging silently undercounts.
- When updating model ids / pricing / API params, consult the `claude-api` skill — don't guess from
  memory.
