// Full headless pipeline demo: mine → triage → resolve → assemble. Prints the session narrative
// and the per-page proposals (amend existing / create new) with their backing facts.
//
// Usage: bun scripts/assemble.ts <arc> <date>

import { join } from 'node:path';
import { mine } from '../src/pipeline/mine';
import { triage } from '../src/pipeline/triage';
import { resolve } from '../src/pipeline/resolve';
import { assemble } from '../src/pipeline/assemble';
import { loadWikiIndex } from '../src/wiki/load';
import { discoverTranscripts } from '../src/transcript/discover';

const TRANSCRIPTS_DIR = '../content/transcripts';
const WIKI_DIR = '../content/wiki';

function toIsoDate(d: string): string {
  return d.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_m, y, mo, da) => `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`);
}

async function main() {
  const arc = process.argv[2];
  const dateArg = process.argv[3];
  if (!arc || !dateArg) { console.error('Usage: bun scripts/assemble.ts <arc> <date>'); process.exit(1); }
  const date = toIsoDate(dateArg);

  const { files } = await discoverTranscripts(TRANSCRIPTS_DIR);
  const file = files.find((f) => f.campaignName === arc && f.sessionDate === date);
  if (!file) { console.error(`No transcript for ${arc}@${date}.`); process.exit(1); }

  console.error('Loading wiki index …');
  const index = await loadWikiIndex({ contentDir: WIKI_DIR });
  console.error(`Mining …`);
  const text = await Bun.file(join(TRANSCRIPTS_DIR, file.filename)).text();
  const { claims } = await mine(text, { transcriptName: file.filename });
  console.error(`  ${claims.length} claims`);
  console.error('Triaging …');
  const t = await triage(claims);
  console.error(`  canon ${t.canon.length} · uncertain ${t.uncertain.length} · noise ${t.noise.length}`);
  console.error('Resolving …');
  const resolved = await resolve(t.canon, { index });
  console.error('Assembling …');
  const a = await assemble(t.canon, resolved);

  const amends = a.proposals.filter((p) => p.kind === 'amend');
  const creates = a.proposals.filter((p) => p.kind === 'create');

  console.log(`\n# Proposals — ${arc}@${date}\n`);
  console.log(`## Session narrative\n${a.narrative}\n`);
  console.log(`${a.proposals.length} proposals · ${amends.length} amend · ${creates.length} create · ${a.unassigned.length} unassigned facts\n`);

  const render = (title: string, ps: typeof a.proposals) => {
    console.log(`## ${title}`);
    for (const p of ps) {
      console.log(`\n### ${p.canonicalName}${p.targetPath ? `  → ${p.targetPath}` : '  (new page)'}`);
      for (const f of p.facts) console.log(`  - ${f.text}  ${f.modality !== 'gm-stated' ? `[${f.modality}] ` : ''}(L${f.citations.map((c) => `${c.start}-${c.end}`).join(',')})`);
    }
    console.log('');
  };
  render(`Amend existing pages (${amends.length})`, amends);
  render(`Create new pages (${creates.length})`, creates);
  process.exit(0);
}

await main();
