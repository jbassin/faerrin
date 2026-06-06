const REQUIRED = ['ANTHROPIC_API_KEY'] as const;

// Model assignments per rewrite stage (spec §6.2). Cheap/structural work on Haiku,
// reasoning-heavy mining/summarizing/conflict on Sonnet. Override any via env.
const MODEL_DEFAULTS = {
  MODEL_MINE:      'claude-sonnet-4-6',
  MODEL_TRIAGE:    'claude-haiku-4-5-20251001',
  MODEL_RESOLVE:   'claude-haiku-4-5-20251001',
  MODEL_SUMMARIZE: 'claude-sonnet-4-6',
  MODEL_CONFLICT:  'claude-sonnet-4-6',
} as const;

export interface Config {
  ANTHROPIC_API_KEY: string;
  MODEL_MINE: string;
  MODEL_TRIAGE: string;
  MODEL_RESOLVE: string;
  MODEL_SUMMARIZE: string;
  MODEL_CONFLICT: string;
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
    MODEL_MINE:      Bun.env.MODEL_MINE      ?? MODEL_DEFAULTS.MODEL_MINE,
    MODEL_TRIAGE:    Bun.env.MODEL_TRIAGE    ?? MODEL_DEFAULTS.MODEL_TRIAGE,
    MODEL_RESOLVE:   Bun.env.MODEL_RESOLVE   ?? MODEL_DEFAULTS.MODEL_RESOLVE,
    MODEL_SUMMARIZE: Bun.env.MODEL_SUMMARIZE ?? MODEL_DEFAULTS.MODEL_SUMMARIZE,
    MODEL_CONFLICT:  Bun.env.MODEL_CONFLICT  ?? MODEL_DEFAULTS.MODEL_CONFLICT,
  };
  cached = Object.freeze(out);
  return cached;
}

export function _resetConfigForTests(): void {
  cached = null;
}
