// Draft candidate eval labels for a session via the LLM (Phase 0b aid, D-12).
//
// A lean preview of the future `mine` stage: chunk a transcript, ask the model for the
// in-world CANON facts a worldbuilder would fold into the wiki (excluding banter/jokes/rules/
// player speculation), each cited to transcript line numbers, then write an EvalLabel the
// worldbuilder reviews and corrects. NOT the production pipeline — a one-shot bootstrap so the
// eval set isn't a cold start.
//
// Usage: bun scripts/draft-labels.ts [arc] [iso-date]
//   defaults: through-a-song-darkly 2025-08-28

import { z } from 'zod';
import { join } from 'node:path';
import { complete } from '../src/llm';
import { config } from '../src/config';
import { discoverTranscripts } from '../src/transcript/discover';
import { chunkTranscript } from '../src/transcript/chunk';
import { normalizeSentence } from '../src/anchor/anchor';
import { writeFileAtomic } from '../src/state/atomic';
import { pool } from '../src/util/pool';
import { SETTING_FACT_SYSTEM } from '../src/pipeline/prompts';
import type { EvalLabel } from '../src/eval/labels';

const TRANSCRIPTS_DIR = '../content/transcripts';
const LABELS_DIR = 'eval/labels';
const CONCURRENCY = 4;

const FactSchema = z.object({
  statement: z.string().describe('One atomic in-world canon fact, in plain prose.'),
  entities: z.array(z.string()).describe('Named entities the fact concerns (people, places, orgs).'),
  startLine: z.number().int().describe('First transcript line number (the NNNNNN prefix) supporting it.'),
  endLine: z.number().int().describe('Last supporting transcript line number.'),
});
const ChunkFactsSchema = z.object({ facts: z.array(FactSchema) });

// Canonical extraction prompt lives in src/pipeline/prompts.ts (shared with the mine stage).

interface DraftFact { statement: string; entities: string[]; start: number; end: number }

/** Accept either 2026-2-10 or 2026-02-10; normalize to ISO zero-padded. */
function toIsoDate(d: string): string {
  return d.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_m, y, mo, da) => `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`);
}

async function main() {
  const arc = process.argv[2] ?? 'through-a-song-darkly';
  const date = toIsoDate(process.argv[3] ?? '2025-08-28');
  const model = config().MODEL_MINE;

  const { files } = await discoverTranscripts(TRANSCRIPTS_DIR);
  const file = files.find((f) => f.campaignName === arc && f.sessionDate === date);
  if (!file) {
    console.error(`No transcript for ${arc}@${date}. Available:`);
    for (const f of files) console.error(`  ${f.campaignName}@${f.sessionDate}`);
    process.exit(1);
  }

  const text = await Bun.file(join(TRANSCRIPTS_DIR, file.filename)).text();
  const { totalLines, windows } = chunkTranscript(text);
  console.error(`Drafting labels for ${arc}@${date} — ${totalLines} lines, ${windows.length} windows (model ${model})`);

  const perWindow = await pool(windows, CONCURRENCY, async (w) => {
    const { value } = await complete({
      stage: 'draft-labels',
      transcript: file.filename,
      model,
      cached: SETTING_FACT_SYSTEM,
      user: `Transcript lines ${w.startLine}–${w.endLine}:\n\n${w.text}`,
      schema: ChunkFactsSchema,
      maxTokens: 8192,
    });
    process.stderr.write(`  window ${w.index} (${w.startLine}-${w.endLine}): ${value.facts.length} facts\n`);
    return value.facts.map((f): DraftFact => ({
      statement: f.statement.trim(),
      entities: f.entities,
      start: f.startLine,
      end: f.endLine,
    }));
  });

  // Merge + dedup by normalized statement (overlap windows produce duplicates).
  const seen = new Map<string, DraftFact>();
  for (const fact of perWindow.flat()) {
    const key = normalizeSentence(fact.statement);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, fact);
  }
  const merged = [...seen.values()].sort((a, b) => a.start - b.start);

  const label: EvalLabel = {
    session: { arc, date },
    canonFacts: merged.map((f, i) => ({
      id: `d${String(i + 1).padStart(3, '0')}`,
      statement: f.statement,
      entities: f.entities,
      citations: [{ start: f.start, end: f.end }],
    })),
    goodSentences: [],
    badSentences: [],
  };

  const outPath = join(LABELS_DIR, `${arc}.${date}.json`);
  await writeFileAtomic(outPath, JSON.stringify(label, null, 2) + '\n');
  console.error(`\nWrote ${label.canonFacts.length} candidate facts → ${outPath}`);
  console.error('These are AI-DRAFTED — review, prune false positives, and add anything missed.');
}

await main();
