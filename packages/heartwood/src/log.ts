import { costUSD } from './pricing';

export interface LLMCallRecord {
  ts: string;              // ISO timestamp
  stage: string;
  transcript?: string;
  page?: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;    // cache_read_input_tokens
  cacheWriteTokens: number; // cache_creation_input_tokens
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

// Append a record to the current run's JSONL file.
// Uses read-then-write because Bun 1.3.x lacks a true append-mode sink;
// fine for dozens of LLM calls per run — revisit if volume reaches ~10k calls.
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
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
  await Bun.write(path, existing + line);
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
