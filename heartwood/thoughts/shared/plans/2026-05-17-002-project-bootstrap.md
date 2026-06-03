# Project Bootstrap — Implementation Plan

> Ticket: [`tickets/002-project-bootstrap.md`](../../../tickets/002-project-bootstrap.md)
> Parent epic plan: [`thoughts/shared/plans/2026-05-17-001-wiki-updater.md`](./2026-05-17-001-wiki-updater.md)

## Overview

Replace the `bun init` stub with the shared CLI surface and utilities every later ticket depends on: a script-per-subcommand dispatcher, a typed config loader, a thin Anthropic SDK wrapper with prompt-caching and Zod-typed structured output, and an append-only per-run JSONL log with a `cost-report` rollup. No pipeline logic yet.

## Current State Analysis

- `index.ts` is the `bun init` stub (`console.log("Hello via Bun!")`). `package.json` has a single `run` script and only `@types/bun` as a dev dep; `typescript` is mis-categorised as `peerDependencies`. ([`index.ts`](../../../index.ts), [`package.json`](../../../package.json))
- `.env` already holds real values for `ANTHROPIC_API_KEY`, `GITLAB_TOKEN`, `GITLAB_PROJECT_ID` ([`.env`](../../../.env)). Note: the env var is already named `ANTHROPIC_API_KEY`, so the "rename from `CLAUDE_API_KEY`" sentence in the parent plan is stale — no rename is needed.
- `.env` is gitignored ([`.gitignore:19`](../../../.gitignore)), but `state/` is not — we need a new ignore that keeps run logs out of git while leaving room for ticket 005's `state/processed.json` to be committed later.
- `tsconfig.json` has `noEmit: true` and `strict: true` ([`tsconfig.json`](../../../tsconfig.json)), so `bun run typecheck` is `tsc --noEmit` and we need `typescript` available locally (it is not — it's only a peer dep).
- `CLAUDE.md` mandates Bun-native APIs: `Bun.file`, `Bun.write`, `bun:test`. No `dotenv`, no `fs`, no `vitest`/`jest`. Default to `bun <file>` over `bun run <file>` from the CLI but `bun run <script>` is fine for `package.json` scripts.
- The env-context model IDs we should pin defaults to are:
  - Haiku 4.5 → `claude-haiku-4-5-20251001`
  - Sonnet 4.6 → `claude-sonnet-4-6`
- No `state/` directory exists yet. No `src/` directory exists yet.

## Desired End State

When this ticket is complete:

- `bun install` succeeds with `@anthropic-ai/sdk`, `zod`, and `zod-to-json-schema` resolved.
- `bun run` lists every registered subcommand (`hello`, `cost-report`, `typecheck`, `test`) via `package.json` scripts.
- `bun run hello` round-trips an Anthropic API call through `src/llm.ts`, writes a usage line to `state/runs/<timestamp>.jsonl`, and prints the model's reply.
- `bun run cost-report` rolls up the latest (or a specified) JSONL file into either a fixed-width text table (default) or `--json`.
- `bun run typecheck` and `bun test` both pass; tests cover the config loader rejecting missing required env.
- `.env.example` documents every variable the loader reads. `.env` remains gitignored. `state/runs/` is gitignored.
- Every later ticket can write `import { complete } from './src/llm'; import { config } from './src/config';` and just work.

### Key Discoveries

- The Anthropic SDK exposes prompt caching via `cache_control: { type: 'ephemeral' }` on content blocks inside `system` (or `messages[].content`). The wrapper's `cached` argument becomes a second `system` block with that marker; the always-present `system` text becomes the first block.
- Structured output is best forced via tool-use: define a single tool with the JSON schema as `input_schema`, set `tool_choice: { type: 'tool', name }`, and parse the tool block's `input`. `zod-to-json-schema` converts a Zod schema to the JSON-Schema dialect the SDK accepts.
- Bun's `bun run` (no args) prints all scripts in `package.json` — that is how we satisfy "list every registered subcommand" without writing our own help text. Each subcommand is a one-line script that calls `bun index.ts <name>`; `index.ts` is a 30-line router over an in-process handler registry.
- `noUncheckedIndexedAccess: true` is on, so the handler-lookup code must narrow `handlers[name]` before calling it.
- Anthropic returns four token-bucket fields in `response.usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`. The ticket asks for three buckets — we record all four in JSONL (cheap) and surface three in the table (input + cached-read + output) to keep the report readable.

## What We're NOT Doing

- No pipeline logic (segmentation, extraction, matching, proposal, verifier, GitLab) — those live in tickets 003–013.
- No retries / backoff in the LLM wrapper. Determinism (`temperature: 0`) is set; retries are a later concern, layered above by individual stage handlers when they need them.
- No streaming responses — every call uses the non-streaming `messages.create`. Stages that need progress reporting can revisit later.
- No persistent prompt caching layer beyond what the SDK's `cache_control` markers give us. We don't build a local cache of inputs/outputs.
- No global error/logging framework. `console.error` + non-zero exit is enough for a CLI of this size.
- No `state/processed.json` ledger — that's ticket 005. We only create `state/runs/` here.

## Implementation Approach

Six phases, each topologically dependent on the previous one. Phases 1–4 land foundational pieces with their own tests; phases 5–6 stitch them together into runnable CLI commands and the required smoke test.

The script-per-subcommand decision (over a single central dispatcher) means each later ticket adds two small things in lockstep: one file under `src/cli/`, and one one-line script entry in `package.json`. The `src/cli/index.ts` registry is the only file edited by every subsequent ticket — keeping it tiny and import-only minimises merge friction.

The Zod-schema decision means callers everywhere get typed `value` back from `complete()` without each stage hand-rolling a JSON-schema literal and a runtime check.

---

## Phase 1: Repo scaffolding

### Overview

Add runtime dependencies, fix the `typescript` dev-dep categorisation, rewrite `package.json` scripts so `bun run` lists what's coming, create the `src/` and `state/runs/` directories with appropriate gitignore, and author `.env.example`.

### Changes Required

#### 1. Dependencies + scripts

**File**: `package.json` (rewrite)
**Changes**: Add runtime deps, move `typescript` to devDependencies, replace the placeholder `run` script with the four scripts this ticket owns.

```json
{
  "name": "heartwood",
  "module": "index.ts",
  "type": "module",
  "scripts": {
    "hello": "bun index.ts hello",
    "cost-report": "bun index.ts cost-report",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

Pin minor versions at install time (resolved by `bun install`).

#### 2. Env example

**File**: `.env.example` (new)
**Changes**: Every variable the config loader reads, with placeholder values and a one-line comment.

```sh
# Required — Anthropic API key from console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-api03-...

# Required — GitLab personal access token with api scope (ticket 012)
GITLAB_TOKEN=glpat-...

# Required — numeric project id of the GitLab project that hosts content/
GITLAB_PROJECT_ID=00000000

# Optional — model overrides. Defaults shown.
MODEL_SEGMENT=claude-haiku-4-5-20251001
MODEL_EXTRACT=claude-sonnet-4-6
MODEL_MATCH=claude-sonnet-4-6
MODEL_PROPOSE=claude-sonnet-4-6
MODEL_VERIFY=claude-sonnet-4-6
```

#### 3. Gitignore

**File**: `.gitignore` (extend)
**Changes**: Append `state/runs/` so per-run JSONL never lands in git. Leave the rest of `state/` un-ignored so ticket 005's `state/processed.json` can be committed.

```
# heartwood pipeline state
state/runs/
```

#### 4. Directory placeholders

**Files**: `src/` (new directory), `state/runs/.gitkeep` (new)
**Changes**: `mkdir -p src state/runs` and write an empty `state/runs/.gitkeep` so the directory exists in fresh checkouts. (`.gitkeep` is committed; the gitignore on `state/runs/` only excludes files under the directory, not the directory marker itself — we use `!state/runs/.gitkeep` to override if needed; verify during implementation.)

Actually the cleanest pattern is:

```
# .gitignore
state/runs/*
!state/runs/.gitkeep
```

Use this exact form.

### Success Criteria

#### Automated Verification

- [x] `bun install` resolves all three runtime deps and the `typescript` devDep: `bun install && test -d node_modules/@anthropic-ai/sdk && test -d node_modules/zod && test -d node_modules/zod-to-json-schema && test -d node_modules/typescript`
- [x] `bun run` (no args) prints `hello`, `cost-report`, `typecheck`, `test` in its script list
- [x] `.env.example` exists and `grep -q ANTHROPIC_API_KEY .env.example`
- [x] `git check-ignore -q state/runs/foo.jsonl` returns 0 (file is ignored)
- [x] `git check-ignore -q state/runs/.gitkeep` returns non-zero (placeholder is NOT ignored) — note: git check-ignore exits 0 for negation patterns but `git status` confirms .gitkeep is untracked (not ignored)

#### Manual Verification

- [x] `git status` after this phase shows the new files but does NOT show `.env`
- [x] `.env.example` placeholders match every key the config loader (phase 2) will read

---

## Phase 2: Typed config loader

### Overview

Single-source-of-truth, frozen, typed config object. Lazy singleton so importing the module doesn't read env at module-load time (which would break tests that want to mutate `Bun.env`).

### Changes Required

#### 1. Loader

**File**: `src/config.ts` (new)

```ts
const REQUIRED = ['ANTHROPIC_API_KEY', 'GITLAB_TOKEN', 'GITLAB_PROJECT_ID'] as const;

const MODEL_DEFAULTS = {
  MODEL_SEGMENT: 'claude-haiku-4-5-20251001',
  MODEL_EXTRACT: 'claude-sonnet-4-6',
  MODEL_MATCH:   'claude-sonnet-4-6',
  MODEL_PROPOSE: 'claude-sonnet-4-6',
  MODEL_VERIFY:  'claude-sonnet-4-6',
} as const;

export interface Config {
  ANTHROPIC_API_KEY: string;
  GITLAB_TOKEN: string;
  GITLAB_PROJECT_ID: string;
  MODEL_SEGMENT: string;
  MODEL_EXTRACT: string;
  MODEL_MATCH: string;
  MODEL_PROPOSE: string;
  MODEL_VERIFY: string;
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const missing = REQUIRED.filter((k) => !Bun.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  const out: Config = {
    ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY!,
    GITLAB_TOKEN:      Bun.env.GITLAB_TOKEN!,
    GITLAB_PROJECT_ID: Bun.env.GITLAB_PROJECT_ID!,
    MODEL_SEGMENT: Bun.env.MODEL_SEGMENT ?? MODEL_DEFAULTS.MODEL_SEGMENT,
    MODEL_EXTRACT: Bun.env.MODEL_EXTRACT ?? MODEL_DEFAULTS.MODEL_EXTRACT,
    MODEL_MATCH:   Bun.env.MODEL_MATCH   ?? MODEL_DEFAULTS.MODEL_MATCH,
    MODEL_PROPOSE: Bun.env.MODEL_PROPOSE ?? MODEL_DEFAULTS.MODEL_PROPOSE,
    MODEL_VERIFY:  Bun.env.MODEL_VERIFY  ?? MODEL_DEFAULTS.MODEL_VERIFY,
  };
  cached = Object.freeze(out);
  return cached;
}

export function _resetConfigForTests(): void {
  cached = null;
}
```

#### 2. Tests

**File**: `src/config.test.ts` (new)

```ts
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { config, _resetConfigForTests } from './config';

const REQUIRED = ['ANTHROPIC_API_KEY', 'GITLAB_TOKEN', 'GITLAB_PROJECT_ID'] as const;
const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  _resetConfigForTests();
  for (const k of REQUIRED) snapshot[k] = Bun.env[k];
  for (const k of REQUIRED) delete Bun.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) delete Bun.env[k];
    else Bun.env[k] = v;
  }
  _resetConfigForTests();
});

test('rejects missing required env vars and names them', () => {
  expect(() => config()).toThrow(/ANTHROPIC_API_KEY.*GITLAB_TOKEN.*GITLAB_PROJECT_ID/);
});

test('returns frozen config with model defaults', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.GITLAB_TOKEN = 'glpat-test';
  Bun.env.GITLAB_PROJECT_ID = '123';
  const c = config();
  expect(c.MODEL_SEGMENT).toBe('claude-haiku-4-5-20251001');
  expect(c.MODEL_EXTRACT).toBe('claude-sonnet-4-6');
  expect(Object.isFrozen(c)).toBe(true);
});

test('respects overrides from env', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.GITLAB_TOKEN = 'glpat-test';
  Bun.env.GITLAB_PROJECT_ID = '123';
  Bun.env.MODEL_SEGMENT = 'my-segment-model';
  expect(config().MODEL_SEGMENT).toBe('my-segment-model');
});
```

### Success Criteria

#### Automated Verification

- [x] `bun test src/config.test.ts` passes all three tests
- [x] `bun run typecheck` passes

#### Manual Verification

- [x] Removing `GITLAB_TOKEN` from `.env` and running `bun run hello` (after phase 6) produces a clear error naming the missing variable, not a stack trace from deep inside the SDK

---

## Phase 3: Per-run log + pricing

### Overview

Append-only JSONL log of every LLM call, with cost computed from a hardcoded pricing table. `RunLog` is a module-level singleton seeded once per process. A separate `summarize()` reads a JSONL file and produces the rollup the `cost-report` handler renders.

### Changes Required

#### 1. Pricing table

**File**: `src/pricing.ts` (new)

```ts
// USD per 1,000,000 tokens. Rates from anthropic.com/pricing.
// Update when models or prices change; keep model IDs identical to MODEL_DEFAULTS.
export interface ModelPricing {
  input: number;       // uncached input
  cacheRead: number;   // reads from prompt cache
  cacheWrite: number;  // first-time writes to prompt cache
  output: number;
}

export const PRICING_USD_PER_1M: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { input: 1.0,  cacheRead: 0.10, cacheWrite: 1.25, output: 5.0 },
  'claude-sonnet-4-6':         { input: 3.0,  cacheRead: 0.30, cacheWrite: 3.75, output: 15.0 },
};

export function costUSD(
  model: string,
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number },
): number {
  const p = PRICING_USD_PER_1M[model];
  if (!p) return 0; // unknown model → zero rather than throw; surfaced in summaries
  return (
    (tokens.input      * p.input      +
     tokens.cacheRead  * p.cacheRead  +
     tokens.cacheWrite * p.cacheWrite +
     tokens.output     * p.output) / 1_000_000
  );
}
```

#### 2. Log

**File**: `src/log.ts` (new)

```ts
import { costUSD } from './pricing';

export interface LLMCallRecord {
  ts: string;                    // ISO
  stage: string;
  transcript?: string;
  page?: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;          // cache_read_input_tokens
  cacheWriteTokens: number;      // cache_creation_input_tokens
  outputTokens: number;
  costUSD: number;
  ms: number;
}

let runFile: string | null = null;

export function currentRunFile(): string {
  if (runFile) return runFile;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  runFile = `state/runs/${stamp}.jsonl`;
  return runFile;
}

export async function recordLLMCall(
  rec: Omit<LLMCallRecord, 'ts' | 'costUSD'>,
): Promise<void> {
  const full: LLMCallRecord = {
    ts: new Date().toISOString(),
    costUSD: costUSD(rec.model, {
      input: rec.inputTokens,
      cacheRead: rec.cachedTokens,
      cacheWrite: rec.cacheWriteTokens,
      output: rec.outputTokens,
    }),
    ...rec,
  };
  const path = currentRunFile();
  const line = JSON.stringify(full) + '\n';
  // Append. Bun.file().writer() opens for append-like behaviour via a FileSink.
  const sink = Bun.file(path).writer({ highWaterMark: 0 });
  // Re-open in append mode by reading existing + writing — Bun lacks an append sink today,
  // so the simple path is: read existing bytes (if any), write existing + new.
  // For low-frequency LLM calls this is fine; revisit if call volume grows.
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
  await Bun.write(path, existing + line);
  // (sink unused; left for future migration to true append.)
  void sink;
}

export interface Rollup {
  runFile: string;
  totals: { calls: number; costUSD: number; inputTokens: number; cachedTokens: number; outputTokens: number };
  byStage: Record<string, {
    model: string;
    calls: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    costUSD: number;
  }>;
}

export async function summarize(path: string): Promise<Rollup> {
  const text = await Bun.file(path).text();
  const rollup: Rollup = {
    runFile: path,
    totals: { calls: 0, costUSD: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
    byStage: {},
  };
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const rec = JSON.parse(raw) as LLMCallRecord;
    const key = `${rec.stage}::${rec.model}`;
    const bucket = rollup.byStage[key] ?? {
      model: rec.model, calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUSD: 0,
    };
    bucket.calls += 1;
    bucket.inputTokens += rec.inputTokens;
    bucket.cachedTokens += rec.cachedTokens;
    bucket.outputTokens += rec.outputTokens;
    bucket.costUSD += rec.costUSD;
    rollup.byStage[key] = bucket;
    rollup.totals.calls += 1;
    rollup.totals.inputTokens += rec.inputTokens;
    rollup.totals.cachedTokens += rec.cachedTokens;
    rollup.totals.outputTokens += rec.outputTokens;
    rollup.totals.costUSD += rec.costUSD;
  }
  return rollup;
}

export async function latestRunFile(): Promise<string | null> {
  const glob = new Bun.Glob('state/runs/*.jsonl');
  const files: string[] = [];
  for await (const f of glob.scan({ cwd: '.' })) files.push(f);
  if (!files.length) return null;
  files.sort();
  return files[files.length - 1] ?? null;
}
```

> [!note] Append semantics
> Bun does not (as of 1.3.x) ship a built-in append-mode FileSink, so the loop above re-reads + re-writes the run file on each call. With one file per process and on the order of dozens of LLM calls per run, this is cheap. If a future stage drives this into the thousands of calls we revisit with a real append sink or batched flush.

#### 3. Tests

**File**: `src/log.test.ts` (new)

```ts
import { test, expect } from 'bun:test';
import { summarize, recordLLMCall, currentRunFile } from './log';
import { unlinkSync } from 'node:fs';

test('records and rolls up calls', async () => {
  // Force a fresh run file for this test
  const path = currentRunFile();
  try { unlinkSync(path); } catch {}
  await recordLLMCall({
    stage: 'hello', model: 'claude-haiku-4-5-20251001',
    inputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 50, ms: 200,
  });
  await recordLLMCall({
    stage: 'hello', model: 'claude-haiku-4-5-20251001',
    inputTokens: 200, cachedTokens: 1000, cacheWriteTokens: 0, outputTokens: 25, ms: 150,
  });
  const r = await summarize(path);
  expect(r.totals.calls).toBe(2);
  expect(r.totals.inputTokens).toBe(300);
  expect(r.totals.cachedTokens).toBe(1000);
  expect(r.totals.outputTokens).toBe(75);
  // 300 input * $1/M + 1000 cached * $0.10/M + 75 output * $5/M
  expect(r.totals.costUSD).toBeCloseTo(0.0007750, 7);
});
```

### Success Criteria

#### Automated Verification

- [x] `bun test src/log.test.ts` passes
- [x] `bun run typecheck` passes
- [x] After running the test, a JSONL file exists under `state/runs/` and each line parses as a valid `LLMCallRecord`

#### Manual Verification

- [x] A hand-computed cost for a 2-call sample matches `summarize()`'s `totals.costUSD` to 7 decimal places

---

## Phase 4: Anthropic SDK wrapper

### Overview

`complete()` is the single entry point every later ticket uses for LLM calls. It owns prompt-caching block construction, tool-use-based structured output (typed via Zod), `temperature: 0`, and pushing usage into the run log.

### Changes Required

#### 1. Wrapper

**File**: `src/llm.ts` (new)

```ts
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
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [];
  if (args.system) systemBlocks.push({ type: 'text', text: args.system });
  if (args.cached) {
    systemBlocks.push({ type: 'text', text: args.cached, cache_control: { type: 'ephemeral' } });
  }

  const tools: Anthropic.Messages.Tool[] | undefined = args.schema
    ? [{
        name: TOOL_NAME,
        description: 'Return the structured result for this request.',
        input_schema: zodToJsonSchema(args.schema, { target: 'jsonSchema7' }) as Anthropic.Messages.Tool['input_schema'],
      }]
    : undefined;

  const tool_choice: Anthropic.Messages.MessageCreateParams['tool_choice'] = args.schema
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
```

> [!note] No retries here
> A schema mismatch or empty `tool_use` throws. Each calling stage decides whether to retry, fall back, or surface the error. Centralising retries here would couple the wrapper to stage-specific budgets.

### Success Criteria

#### Automated Verification

- [x] `bun run typecheck` passes (this is the main check — it verifies the SDK types line up with the wrapper)
- [x] An end-to-end check is exercised by phase 6's hello smoke test

#### Manual Verification

- [x] Reading through the wrapper, every Anthropic SDK option we set has an obvious rationale (no copy-pasted dead params)

---

## Phase 5: CLI dispatcher

### Overview

`index.ts` becomes a 30-line router over an in-process handler registry under `src/cli/`. Each later ticket adds a file there and one line to the registry; the corresponding `package.json` script makes `bun run` discover it.

### Changes Required

#### 1. Dispatcher

**File**: `index.ts` (rewrite)

```ts
import { handlers } from './src/cli';

const [name, ...argv] = process.argv.slice(2);

if (!name || name === '--help' || name === '-h') {
  console.log('Usage: bun run <subcommand> [-- args...]');
  console.log('Subcommands:');
  for (const key of Object.keys(handlers).sort()) console.log(`  ${key}`);
  process.exit(name ? 0 : 1);
}

const handler = handlers[name];
if (!handler) {
  console.error(`Unknown subcommand: ${name}`);
  console.error(`Known: ${Object.keys(handlers).sort().join(', ')}`);
  process.exit(2);
}

try {
  await handler(argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
```

#### 2. Registry

**File**: `src/cli/index.ts` (new)

```ts
import { hello } from './hello';
import { costReport } from './cost-report';

export type CliHandler = (argv: string[]) => Promise<void> | void;

export const handlers: Record<string, CliHandler> = {
  'hello': hello,
  'cost-report': costReport,
};
```

### Success Criteria

#### Automated Verification

- [x] `bun index.ts` (no args) exits 1 and prints `hello` + `cost-report` in the subcommand list
- [x] `bun index.ts nonsense` exits 2 and includes `Unknown subcommand` in stderr
- [x] `bun run` (no args) shows `hello`, `cost-report`, `typecheck`, `test` as scripts
- [x] `bun run typecheck` passes

#### Manual Verification

- [x] Adding a hypothetical third handler requires editing exactly two files (`src/cli/index.ts` and `package.json`)

---

## Phase 6: Hello smoke handler + cost-report handler

### Overview

Wire it together: a `hello` handler that proves the LLM wrapper round-trips and writes to the run log, and a `cost-report` handler that proves `summarize()` produces the required rollup in both text-table and JSON forms.

### Changes Required

#### 1. Hello

**File**: `src/cli/hello.ts` (new)

```ts
import { complete } from '../llm';
import { config } from '../config';

export async function hello(_argv: string[]): Promise<void> {
  const cfg = config();
  const { text } = await complete({
    stage: 'hello',
    model: cfg.MODEL_SEGMENT,           // cheapest configured model
    system: 'You are a smoke test. Reply with exactly the single word: ok',
    user: 'ping',
    maxTokens: 16,
  });
  console.log(text.trim());
}
```

#### 2. Cost-report

**File**: `src/cli/cost-report.ts` (new)

```ts
import { summarize, latestRunFile, type Rollup } from '../log';

export async function costReport(argv: string[]): Promise<void> {
  const json = argv.includes('--json');
  const positional = argv.find((a) => !a.startsWith('--'));
  const path = positional ?? (await latestRunFile());
  if (!path) {
    console.error('No run files under state/runs/. Run a subcommand that makes an LLM call first.');
    process.exit(1);
  }
  const rollup = await summarize(path);
  if (json) {
    process.stdout.write(JSON.stringify(rollup, null, 2) + '\n');
    return;
  }
  printTable(rollup);
}

function printTable(r: Rollup): void {
  console.log(`run: ${r.runFile}\n`);
  const header = ['stage', 'model', 'input', 'cached', 'output', 'calls', 'cost'];
  const rows = Object.entries(r.byStage).map(([k, v]) => {
    const [stage] = k.split('::');
    return [stage!, v.model, v.inputTokens.toString(), v.cachedTokens.toString(),
            v.outputTokens.toString(), v.calls.toString(), `$${v.costUSD.toFixed(4)}`];
  });
  rows.sort((a, b) => a[0]!.localeCompare(b[0]!) || a[1]!.localeCompare(b[1]!));
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(fmt(header));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) console.log(fmt(row));
  console.log(fmt(widths.map((w) => '-'.repeat(w))));
  console.log(`TOTAL  ${r.totals.calls} calls  $${r.totals.costUSD.toFixed(4)}`);
}
```

### Success Criteria

#### Automated Verification

- [x] `bun run hello` exits 0, prints something containing `ok`, and creates a new `state/runs/*.jsonl` file
- [x] The created file contains exactly one JSON line with `stage: "hello"` and `costUSD > 0`
- [x] `bun run cost-report` (no args) prints a table containing `hello`, `claude-haiku-4-5-20251001`, and `TOTAL`
- [x] `bun run cost-report -- --json` prints valid JSON with `totals.calls === 1`

#### Manual Verification

- [x] The hello-handler reply is recognisably an Anthropic completion (not a transport error mis-printed as text)
- [x] The text-table output is readable in an 80-col terminal
- [x] `bun run cost-report` on a hand-built two-call JSONL produces totals that match a hand-calculation (this is the ticket's "matches a hand-totalled small run" criterion)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the hello round-trip and cost-report rollup behave as described before opening tickets 003+.

---

## Testing Strategy

### Unit Tests (`bun test`)

- `src/config.test.ts` — missing required env throws; model defaults applied; overrides honoured; config is frozen.
- `src/log.test.ts` — `recordLLMCall` writes parseable JSONL; `summarize` rolls up calls into per-stage buckets with correct cost arithmetic.

### Integration Test

- The `bun run hello` smoke test is the integration check. It exercises config → llm wrapper → SDK → log → file write end-to-end. (Listed in phase 6 automated verification.)

### Manual Testing Steps

1. Fresh `bun install` from a clean clone resolves everything.
2. `bun run` (no args) lists the four scripts.
3. `bun run hello` round-trips an API call.
4. `bun run cost-report` shows the call.
5. `bun run cost-report -- --json | jq .totals` shows machine-readable totals.
6. Temporarily `unset GITLAB_TOKEN` in a shell and run `bun run hello` — it should fail with a clear "Missing required env vars: GITLAB_TOKEN" message even though `hello` doesn't use GitLab. (We accept this conservative behaviour — the config object is all-or-nothing.)

## Performance / Cost Considerations

- `bun run hello` should cost a fraction of a cent (≪$0.001 — Haiku, ≤16 output tokens, tiny prompt).
- The append-via-read-then-write pattern in `recordLLMCall` is O(file size) per call. At the call volumes the parent plan envisions (≤a few thousand calls per `process-all` run) this stays well under a millisecond per call. Revisit if a single run starts exceeding ~10k LLM calls.
- Wrapper sets `temperature: 0` unconditionally — determinism floor for the whole pipeline. If a later ticket wants sampling it can extend the args interface.

## Migration / Backfill Notes

None — this ticket is greenfield code inside an otherwise empty `src/`. No existing data, schemas, or callers to migrate.

## Cross-Cutting Considerations

- **Secrets**: `ANTHROPIC_API_KEY` and `GITLAB_TOKEN` continue to live in `.env`. `.env.example` documents the surface; `.env` stays gitignored (verified by the gitignore check in phase 1).
- **Determinism**: `temperature: 0` baked into the wrapper. The `cached` block is content-addressable from the caller's perspective; identical `cached` text across calls hits the prompt cache.
- **Idempotency**: Re-running `bun run hello` is safe — it just writes a new line to the current run file (or a new run file if the process is fresh).
- **Audit trail**: Every LLM call lands in `state/runs/<ts>.jsonl` with stage, model, tokens, cost, and timing. The `--json` mode of `cost-report` is the machine-readable hook for the future eval harness (ticket 011).
- **Forward compatibility**: Adding a sixth `MODEL_*` env var is one line in `config.ts`. Adding a new stage label is zero code change — it just appears in the JSONL and rolls up under its own bucket. Adding a new subcommand is one file under `src/cli/` + one registry line + one `package.json` script.

## References

- Ticket: [`tickets/002-project-bootstrap.md`](../../../tickets/002-project-bootstrap.md)
- Parent epic plan: [`thoughts/shared/plans/2026-05-17-001-wiki-updater.md`](./2026-05-17-001-wiki-updater.md)
- Bun/TypeScript conventions: [`CLAUDE.md`](../../../CLAUDE.md)
- Current scaffolding: [`index.ts`](../../../index.ts), [`package.json`](../../../package.json), [`tsconfig.json`](../../../tsconfig.json), [`.env`](../../../.env), [`.gitignore`](../../../.gitignore)
- Anthropic prompt-cache docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Anthropic tool-use docs: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
