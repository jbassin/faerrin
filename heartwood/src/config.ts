const REQUIRED = ['ANTHROPIC_API_KEY', 'GITLAB_TOKEN', 'GITLAB_PROJECT_ID', 'GITLAB_URL'] as const;

const MODEL_DEFAULTS = {
  MODEL_SEGMENT: 'claude-haiku-4-5-20251001',
  MODEL_EXTRACT: 'claude-sonnet-4-6',
  MODEL_FILTER:  'claude-haiku-4-5-20251001',
  MODEL_RESOLVE: 'claude-haiku-4-5-20251001',
  MODEL_MATCH:   'claude-sonnet-4-6',
  MODEL_PROPOSE: 'claude-sonnet-4-6',
  MODEL_VERIFY:  'claude-sonnet-4-6',
} as const;

export interface Config {
  ANTHROPIC_API_KEY: string;
  GITLAB_TOKEN:      string;
  GITLAB_PROJECT_ID: string;
  GITLAB_URL:        string;
  MODEL_SEGMENT: string;
  MODEL_EXTRACT: string;
  MODEL_FILTER: string;
  MODEL_RESOLVE: string;
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
    GITLAB_URL:        Bun.env.GITLAB_URL!,
    MODEL_SEGMENT: Bun.env.MODEL_SEGMENT ?? MODEL_DEFAULTS.MODEL_SEGMENT,
    MODEL_EXTRACT: Bun.env.MODEL_EXTRACT ?? MODEL_DEFAULTS.MODEL_EXTRACT,
    MODEL_FILTER:  Bun.env.MODEL_FILTER  ?? MODEL_DEFAULTS.MODEL_FILTER,
    MODEL_RESOLVE: Bun.env.MODEL_RESOLVE ?? MODEL_DEFAULTS.MODEL_RESOLVE,
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
