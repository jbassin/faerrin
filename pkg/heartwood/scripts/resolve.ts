// Inspect entity resolution on a session: mine → resolve, then print the entity registry
// (known wiki matches vs new pending entities, and the merges needing confirmation).
//
// Usage: bun scripts/resolve.ts <arc> <date>

import { join } from 'node:path';
import { mine } from '../src/pipeline/mine';
import { resolve } from '../src/pipeline/resolve';
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
  if (!arc || !dateArg) {
    console.error('Usage: bun scripts/resolve.ts <arc> <date>');
    process.exit(1);
  }
  const date = toIsoDate(dateArg);

  const { files } = await discoverTranscripts(TRANSCRIPTS_DIR);
  const file = files.find((f) => f.campaignName === arc && f.sessionDate === date);
  if (!file) { console.error(`No transcript for ${arc}@${date}.`); process.exit(1); }

  console.error('Loading wiki index …');
  const index = await loadWikiIndex({ contentDir: WIKI_DIR });
  console.error(`  ${index.pageCount} wiki pages`);

  console.error(`Mining ${arc}@${date} …`);
  const text = await Bun.file(join(TRANSCRIPTS_DIR, file.filename)).text();
  const { claims } = await mine(text, { transcriptName: file.filename });
  console.error(`  ${claims.length} claims`);

  console.error('Resolving entities …');
  const r = await resolve(claims, { index });

  const known = r.entities.filter((e) => e.status === 'known');
  const pending = r.entities.filter((e) => e.status === 'pending');
  console.log(`\n# Resolve — ${arc}@${date}`);
  console.log(`- entities: ${r.entities.length} (${known.length} known wiki pages · ${pending.length} new/pending)`);
  console.log(`- needs confirmation (merges + new): ${r.needsConfirmation.length}`);

  console.log(`\n## Known (resolved to existing pages) — ${known.length}`);
  for (const e of known.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))) {
    const conf = e.confidence === 'low' ? ' ⚠ confirm' : '';
    console.log(`- ${e.canonicalName}  →  ${e.wikiPath}${e.aliases.length > 1 ? `  [${e.aliases.join(', ')}]` : ''}${conf}`);
  }
  console.log(`\n## New / pending (would create a page) — ${pending.length}`);
  for (const e of pending.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))) {
    console.log(`- ${e.canonicalName}${e.aliases.length > 1 ? `  [${e.aliases.join(', ')}]` : ''}`);
  }
  process.exit(0);
}

await main();
