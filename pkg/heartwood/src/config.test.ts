import { test, expect, beforeEach, afterEach } from 'bun:test';
import { config, _resetConfigForTests } from './config';

const REQUIRED = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO'] as const;
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
  expect(() => config()).toThrow(/ANTHROPIC_API_KEY.*GITHUB_TOKEN.*GITHUB_REPO/);
});

test('returns frozen config with model defaults and default API url', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.GITHUB_TOKEN = 'ghp-test';
  Bun.env.GITHUB_REPO = 'owner/repo';
  const c = config();
  expect(c.GITHUB_API_URL).toBe('https://api.github.com');
  expect(c.MODEL_SEGMENT).toBe('claude-haiku-4-5-20251001');
  expect(c.MODEL_EXTRACT).toBe('claude-sonnet-4-6');
  expect(Object.isFrozen(c)).toBe(true);
});

test('respects overrides from env', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.GITHUB_TOKEN = 'ghp-test';
  Bun.env.GITHUB_REPO = 'owner/repo';
  Bun.env.MODEL_SEGMENT = 'my-segment-model';
  expect(config().MODEL_SEGMENT).toBe('my-segment-model');
});
