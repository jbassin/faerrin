// Eval CLI (Phase 0b → Phase 1): run the mine stage on a labeled session and score it against
// the worldbuilder's hand-reviewed labels.
//
// Usage: bun scripts/eval.ts <arc> <date> [--save]
//   e.g. bun scripts/eval.ts interred-in-iomenei 2026-2-10

import { join } from 'node:path';
import { readEvalLabel } from '../src/eval/labels';
import { scoreSession, formatScore } from '../src/eval/run';
import { mine } from '../src/pipeline/mine';
import { triage } from '../src/pipeline/triage';
import { judgeMatchMap, matcherFromMap } from '../src/eval/judge';
import { tokenMatcher } from '../src/eval/score';
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
  const useToken = process.argv.includes('--token');
  const noTriage = process.argv.includes('--no-triage');
  if (!arc || !dateArg) {
    console.error('Usage: bun scripts/eval.ts <arc> <date> [--save] [--token]');
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
  const { claims, windows, rawCount, droppedNoEntity } = await mine(text, { transcriptName: file.filename });
  console.error(`  ${windows} windows · ${rawCount} raw → ${claims.length} claims (dropped ${droppedNoEntity} entity-less)`);

  const matcher = useToken
    ? tokenMatcher()
    : matcherFromMap(await (async () => {
        console.error('  judging matches (LLM) …');
        return judgeMatchMap(label.canonFacts, claims);
      })());

  const score = scoreSession(label, claims, matcher);
  let report = formatScore(score);

  if (!noTriage) {
    console.error('  triaging …');
    const t = await triage(claims);
    const canonScore = scoreSession(label, t.canon, matcher); // reuse the same match map
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

    // Safety: a kept fact is "hidden" if every claim matching it landed in noise (the reviewer
    // would never see it). D-4 says triage must keep noise conservative — this should stay ~0.
    const reviewable = new Set([...t.canon, ...t.uncertain].map((c) => c.id));
    let hidden = 0;
    for (const fact of label.canonFacts) {
      const matching = claims.filter((c) => matcher(fact, c));
      if (matching.length > 0 && !matching.some((c) => reviewable.has(c.id))) hidden++;
    }

    report +=
      `\n\n## Triage` +
      `\n- buckets: canon ${t.canon.length} · uncertain ${t.uncertain.length} · noise ${t.noise.length}` +
      `\n- **canon-bucket coverage: ${pct(canonScore.coverage.coverage)}** (${canonScore.coverage.covered}/${canonScore.coverage.total}) — kept facts that survived into canon` +
      `\n- **canon-bucket precision: ${pct(canonScore.precision.precision)}** (${canonScore.precision.matched}/${canonScore.precision.total}) — canon claims that are kept facts` +
      `\n- **kept facts hidden in noise: ${hidden}** (must stay ~0 — these would never reach the reviewer)`;
  }

  console.log('\n' + report + '\n');

  if (save) {
    await writeFileAtomic(join(OUT_DIR, `${arc}.${date}.md`), report + '\n');
    await writeFileAtomic(join(OUT_DIR, `${arc}.${date}.claims.json`), JSON.stringify(claims, null, 2) + '\n');
    console.error(`Saved report + claims to ${OUT_DIR}/`);
  }
  process.exit(0);
}

await main();
