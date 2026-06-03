// USD per 1,000,000 tokens. Rates from anthropic.com/pricing — update when models or prices change.
export interface ModelPricing {
  input: number;      // uncached input
  cacheRead: number;  // reads from prompt cache
  cacheWrite: number; // first-time writes to prompt cache
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
    tokens.input      * p.input      +
    tokens.cacheRead  * p.cacheRead  +
    tokens.cacheWrite * p.cacheWrite +
    tokens.output     * p.output
  ) / 1_000_000;
}
