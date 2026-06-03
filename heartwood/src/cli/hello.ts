import { complete } from '../llm';
import { config } from '../config';
import type { Command } from 'commander';

export interface HelloCliOptions {}

export async function hello(opts: HelloCliOptions = {}): Promise<void> {
  void opts;
  const cfg = config();
  const { text } = await complete({
    stage: 'hello',
    model: cfg.MODEL_SEGMENT,
    system: 'You are a smoke test. Reply with exactly the single word: ok',
    user: 'ping',
    maxTokens: 16,
  });
  console.log(text.trim());
}

export function register(program: Command): void {
  program
    .command('hello')
    .description('Smoke-test the LLM connection')
    .action(() => hello());
}
