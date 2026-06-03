import { test, expect } from 'bun:test';
import { summarize, recordLLMCall, currentRunFile } from './log';
import { unlinkSync } from 'node:fs';

test('records and rolls up calls', async () => {
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
