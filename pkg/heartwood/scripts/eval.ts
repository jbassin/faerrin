// Eval CLI (Phase 0b → Phase 1): run the mine stage on a labeled session and score it against
// the worldbuilder's hand-reviewed labels.
//
// Usage: bun scripts/eval.ts <arc> <date> [--save]
//   e.g. bun scripts/eval.ts interred-in-iomenei 2026-2-10

import { join } from 'node:path';
import { readEvalLabel } from '../src/eval/labels';
import { scoreSession, formatScore } from '../src/eval/run';
import { mine } from '../src/pipeline/mine';
import { discoverTranscripts } from '../src/transcript/discover';
import { writeFileAtomic } from '../src/state/atomic';

const TRANSCRIPTS_DIR = '../content/transcripts';
const LABELS_DIR = 'eval/labels';
const OUT_DIR = 'eval/results';

function toIsoDate(d: string): string {
  return d.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_m, y, mo, da) => `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`);
}

async function main() {
  const arc = process.argv[2];
  const dateArg = process.argv[3];
  const save = process.argv.includes('--save');
  if (!arc || !dateArg) {
    console.error('Usage: bun scripts/eval.ts <arc> <date> [--save]');
    process.exit(1);
  }
  const date = toIsoDate(dateArg);

  const label = await readEvalLabel(join(LABELS_DIR, `${arc}.${date}.json`));
  const { files } = await discoverTranscripts(TRANSCRIPTS_DIR);
  const file = files.find((f) => f.campaignName === arc && f.sessionDate === date);
  if (!file) {
    console.error(`No transcript for ${arc}@${date}.`);
    process.exit(1);
  }

  const text = await Bun.file(join(TRANSCRIPTS_DIR, file.filename)).text();
  console.error(`Mining ${arc}@${date} …`);
  const { claims, windows, rawCount } = await mine(text, { transcriptName: file.filename });
  console.error(`  ${windows} windows · ${rawCount} raw → ${claims.length} deduped claims`);

  const score = scoreSession(label, claims);
  const report = formatScore(score);
  console.log('\n' + report + '\n');

  if (save) {
    await writeFileAtomic(join(OUT_DIR, `${arc}.${date}.md`), report + '\n');
    await writeFileAtomic(join(OUT_DIR, `${arc}.${date}.claims.json`), JSON.stringify(claims, null, 2) + '\n');
    console.error(`Saved report + claims to ${OUT_DIR}/`);
  }
  process.exit(0);
}

await main();
