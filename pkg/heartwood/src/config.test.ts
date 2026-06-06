import { test, expect, beforeEach, afterEach } from 'bun:test';
import { config, _resetConfigForTests } from './config';

const TOUCHED = ['ANTHROPIC_API_KEY', 'MODEL_MINE'] as const;
const snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  _resetConfigForTests();
  for (const k of TOUCHED) snapshot[k] = Bun.env[k];
  for (const k of TOUCHED) delete Bun.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) delete Bun.env[k];
    else Bun.env[k] = v;
  }
  _resetConfigForTests();
});

test('rejects missing required env vars and names them', () => {
  expect(() => config()).toThrow(/ANTHROPIC_API_KEY/);
});

test('returns frozen config with model defaults', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  const c = config();
  expect(c.MODEL_MINE).toBe('claude-sonnet-4-6');
  expect(c.MODEL_TRIAGE).toBe('claude-haiku-4-5-20251001');
  expect(c.MODEL_SUMMARIZE).toBe('claude-sonnet-4-6');
  expect(Object.isFrozen(c)).toBe(true);
});

test('respects overrides from env', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.MODEL_MINE = 'my-mine-model';
  expect(config().MODEL_MINE).toBe('my-mine-model');
});
