import { Command } from 'commander';
import { registerAll } from './src/cli';

const program = new Command()
  .name('heartwood')
  .description('Heartwood transcript pipeline');

registerAll(program);
await program.parseAsync(process.argv);
