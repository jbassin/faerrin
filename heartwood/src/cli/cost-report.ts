import { summarize, latestRunFile, type Rollup } from '../log';
import type { Command } from 'commander';

export interface CostReportCliOptions {}

export async function costReport(
  path: string | undefined,
  flags: { json?: boolean },
  opts: CostReportCliOptions = {},
): Promise<void> {
  void opts;
  const json = flags.json ?? false;
  const resolvedPath = path ?? (await latestRunFile());
  if (!resolvedPath) {
    console.error('No run files under state/runs/. Run a subcommand that makes an LLM call first.');
    process.exit(1);
    return;
  }
  const rollup = await summarize(resolvedPath);
  if (json) {
    process.stdout.write(JSON.stringify(rollup, null, 2) + '\n');
    return;
  }
  printTable(rollup);
}

export function register(program: Command): void {
  program
    .command('cost-report [path]')
    .description('Print LLM cost report for a run')
    .option('--json', 'output as JSON')
    .action((p: string | undefined, opts: { json?: boolean }) => costReport(p, opts));
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
