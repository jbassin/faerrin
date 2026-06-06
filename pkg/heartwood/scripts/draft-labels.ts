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

const SYSTEM = `You extract in-world CANON facts from a Pathfinder 2e session transcript chunk, for a worldbuilding wiki.

A CANON fact is something the Game Master established as true about the world: places, people, organizations, events, relationships, history, cosmology. Capture what a careful wiki editor would record after the session.

STRICTLY EXCLUDE:
- Out-of-character table banter, jokes, real-world tangents, scheduling, snacks.
- Rules/mechanics discussion and dice talk.
- Player SPECULATION or guesses ("maybe it's...", "I bet...") — only what the GM affirmed.
- Pure combat blow-by-blow with no lasting world fact.

Each fact must be ATOMIC (one fact per entry), stated plainly, with the named entities it concerns, and cited to the transcript line numbers (the leading NNNNNN on each line) that support it. If a chunk has no canon facts, return an empty list.`;

interface DraftFact { statement: string; entities: string[]; start: number; end: number }

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

async function main() {
  const arc = process.argv[2] ?? 'through-a-song-darkly';
  const date = process.argv[3] ?? '2025-08-28';
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
      cached: SYSTEM,
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
