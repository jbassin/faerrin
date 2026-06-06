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

const SYSTEM = `You extract durable SETTING facts from a Pathfinder 2e session transcript chunk, for a worldbuilding wiki.

The wiki records the PERSISTENT STATE OF THE WORLD — the properties, relationships, history, and lore of people, places, organizations, objects, and concepts. It is NOT a log of what happened during the session.

The test for every fact: "Would this still be true and worth recording if this session had never been played — is it a fact ABOUT the world, or a fact about what the PARTY DID?" Keep facts about the world; drop the session narrative.

KEEP (setting/state facts):
- Who a person/NPC is, their traits, role, relationships, origin, family.
- What a place is and its features; what an organization/faction is and does.
- World concepts, cosmology, history, and how things work.
e.g. "Copperjaw operates Sableclutch Scrap and has a copper-jaw prosthetic"; "Hallia's tram runs along a route called the Horizon"; "Fanes are spaces sustained by Hearts".

STRICTLY EXCLUDE:
- SESSION-EVENT NARRATIVE: what the party did, where they went, quest/mission progress, encounters, retrievals, scene-by-scene events. e.g. "the party retrieved the dish", "the party traced the man to a train", "the session ended with...". These are the single most common mistake — do not record them.
- GAME MECHANICS: for a character, record physical characteristics and personality, but NOT abilities, stats, spells they can cast, weapons they wield, action economy, or levels (PF2e stat-block content). e.g. drop "Krod wields a Nodachi with the extend property" and "Mordecai has Magnificent Mansion"; a characterful trait like "Krod can sense blood like a bloodhound" is fine.
- Out-of-character banter, jokes, real-world tangents, scheduling, rules/dice talk.
- Player SPECULATION/guesses — only what the GM affirmed about the world.

EXTRACT THE STANDING FACT FROM AN EVENT: if an event reveals a durable world-fact, record the fact, not the action. "Flynn's body was recovered and returned to base" → record "Flynn is dead". "Anzu's raven Othello rejoined the party" → record "Anzu has a raven companion named Othello".

USE CANONICAL NAMES: prefer the most specific proper name the transcript provides over generic referents. If a place/person is named, use the name (e.g. "the Verdant Expanse", not "the forest"); resolve obvious referents within the chunk.

Each fact must be ATOMIC (one per entry), stated plainly, with the named entities it concerns, and cited to the transcript line numbers (the leading NNNNNN on each line). If a chunk has no setting facts, return an empty list.`;

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
