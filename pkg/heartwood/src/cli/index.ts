import { Command } from 'commander';
import { register as registerHello }       from './hello';
import { register as registerCostReport }  from './cost-report';
import { register as registerIndexWiki }   from './index-wiki';
import { register as registerSegment }     from './segment';
import { register as registerExtract }     from './extract';
import { register as registerResolve }     from './resolve';
import { register as registerMatch }       from './match';
import { register as registerPropose }     from './propose';
import { register as registerSubmit }      from './submit';
import { register as registerRespond }     from './respond';
import { register as registerTranscripts } from './transcripts';
import { register as registerProcess }     from './process';

export function registerAll(program: Command): void {
  registerHello(program);
  registerCostReport(program);
  registerIndexWiki(program);
  registerSegment(program);
  registerExtract(program);
  registerResolve(program);
  registerMatch(program);
  registerPropose(program);
  registerSubmit(program);
  registerRespond(program);
  registerTranscripts(program);
  registerProcess(program);
}
