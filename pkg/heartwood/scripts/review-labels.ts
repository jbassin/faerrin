// Interactive CLI to triage AI-drafted eval labels (Phase 0b).
//
// Usage: bun scripts/review-labels.ts <arc> <date>
//   e.g. bun scripts/review-labels.ts through-a-song-darkly 2025-08-28
//
// Shows each un-reviewed candidate fact with its cited transcript lines and lets you
// approve (a/⏎), edit (e), deny (d), skip (s), or quit (q). Denied facts are removed;
// survivors are marked reviewed so you can resume. Writes back to the same label file.

import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { readEvalLabel } from '../src/eval/labels';
import { reviewLabels, type ReviewDeps } from '../src/eval/review';
import { writeFileAtomic } from '../src/state/atomic';
import { discoverTranscripts } from '../src/transcript/discover';
import type { LabeledFact } from '../src/eval/labels';

const TRANSCRIPTS_DIR = '../content/transcripts';
const LABELS_DIR = 'eval/labels';
const MAX_CONTEXT_LINES = 16;

function makeTerminal() {
  const stdin = process.stdin;
  return {
    key(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      return new Promise((resolve) => {
        if (!stdin.isTTY) {
          resolve('q'); // non-interactive: bail safely
          return;
        }
        stdin.setRawMode(true);
        stdin.resume();
        const onData = (buf: Buffer) => {
          const s = buf.toString('utf8');
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          if (s === '') {
            process.stdout.write('\n');
            process.exit(130);
          }
          const isEnter = s === '\r' || s === '\n';
          process.stdout.write(`${isEnter ? '⏎' : s.replace(/[\r\n]/g, '')}\n`);
          resolve(isEnter ? '' : s);
        };
        stdin.on('data', onData);
      });
    },
    line(prompt: string): Promise<string> {
      const rl = createInterface({ input: stdin, output: process.stdout });
      return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
    },
  };
}

async function loadTranscriptLines(arc: string, date: string): Promise<string[] | null> {
  const { files } = await discoverTranscripts(TRANSCRIPTS_DIR);
  const file = files.find((f) => f.campaignName === arc && f.sessionDate === date);
  if (!file) return null;
  const text = await Bun.file(join(TRANSCRIPTS_DIR, file.filename)).text();
  return text.split('\n');
}

function contextFor(lines: string[]) {
  return (fact: LabeledFact): string[] => {
    const out: string[] = [];
    for (const c of fact.citations ?? []) {
      const start = Math.max(1, c.start);
      const end = Math.max(start, c.end);
      const slice = lines.slice(start - 1, Math.min(end, start - 1 + MAX_CONTEXT_LINES));
      for (const l of slice) if (l.trim()) out.push(l);
      if (end - start + 1 > MAX_CONTEXT_LINES) out.push(`    … (${end - start + 1 - MAX_CONTEXT_LINES} more lines)`);
    }
    return out;
  };
}

/** Accept either 2026-2-10 or 2026-02-10; normalize to ISO zero-padded. */
function toIsoDate(d: string): string {
  return d.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_m, y, mo, da) => `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`);
}

async function main() {
  const arc = process.argv[2];
  const dateArg = process.argv[3];
  if (!arc || !dateArg) {
    console.error('Usage: bun scripts/review-labels.ts <arc> <date>');
    process.exit(1);
  }
  const date = toIsoDate(dateArg);

  const path = join(LABELS_DIR, `${arc}.${date}.json`);
  const label = await readEvalLabel(path);
  const lines = await loadTranscriptLines(arc, date);
  if (!lines) console.error(`(no transcript found for ${arc}@${date} — reviewing without context)\n`);

  const pending = label.canonFacts.filter((f) => !f.reviewed).length;
  console.error(`Reviewing ${arc}@${date}: ${pending} candidate(s) pending (${label.canonFacts.length} total).`);
  console.error('Keys: a/⏎ approve · e edit · d deny · s skip · q quit\n');

  const term = makeTerminal();
  const deps: ReviewDeps = {
    key: term.key,
    line: term.line,
    out: (s) => console.log(s),
    ...(lines ? { context: contextFor(lines) } : {}),
  };

  const { label: reviewed, stats } = await reviewLabels(label, deps);
  await writeFileAtomic(path, JSON.stringify(reviewed, null, 2) + '\n');

  console.error(
    `\nDone. approved ${stats.approved} · edited ${stats.edited} · denied ${stats.denied} · ` +
      `skipped ${stats.skipped}${stats.quit ? ' · (quit early)' : ''}`,
  );
  console.error(`${reviewed.canonFacts.length} fact(s) remain in ${path}.`);
  process.exit(0);
}

await main();
