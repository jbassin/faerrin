import { Command } from 'commander';
import { register as registerHello }      from './hello';
import { register as registerCostReport } from './cost-report';

export function registerAll(program: Command): void {
  registerHello(program);
  registerCostReport(program);
}
