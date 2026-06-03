import { test, expect, beforeEach, afterEach } from 'bun:test';
import { config, _resetConfigForTests } from './config';

const REQUIRED = ['ANTHROPIC_API_KEY', 'GITLAB_TOKEN', 'GITLAB_PROJECT_ID', 'GITLAB_URL'] as const;
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
  expect(() => config()).toThrow(/ANTHROPIC_API_KEY.*GITLAB_TOKEN.*GITLAB_PROJECT_ID.*GITLAB_URL/);
});

test('returns frozen config with model defaults', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.GITLAB_TOKEN = 'glpat-test';
  Bun.env.GITLAB_PROJECT_ID = '123';
  Bun.env.GITLAB_URL = 'https://gitlab.example.com';
  const c = config();
  expect(c.MODEL_SEGMENT).toBe('claude-haiku-4-5-20251001');
  expect(c.MODEL_EXTRACT).toBe('claude-sonnet-4-6');
  expect(Object.isFrozen(c)).toBe(true);
});

test('respects overrides from env', () => {
  Bun.env.ANTHROPIC_API_KEY = 'sk-test';
  Bun.env.GITLAB_TOKEN = 'glpat-test';
  Bun.env.GITLAB_PROJECT_ID = '123';
  Bun.env.GITLAB_URL = 'https://gitlab.example.com';
  Bun.env.MODEL_SEGMENT = 'my-segment-model';
  expect(config().MODEL_SEGMENT).toBe('my-segment-model');
});
