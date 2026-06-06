// Ingest CLI: run the full headless pipeline (mine → triage → resolve → assemble →
// conflict) for one session and PERSIST a SessionArtifact the review app reads. This
// is the expensive, LLM-backed step; it runs once per session, not on every review
// page load. Runs under Bun (LLM via complete(), .env auto-loaded).
//
// Usage: bun scripts/ingest.ts <arc> <date>

import { join } from 'node:path';
import { mine } from '../src/pipeline/mine';
import { triage } from '../src/pipeline/triage';
import { resolve } from '../src/pipeline/resolve';
import { assemble } from '../src/pipeline/assemble';
import { detectConflicts } from '../src/pipeline/conflict';
import { loadWikiIndex } from '../src/wiki/load';
import { discoverTranscripts } from '../src/transcript/discover';
import { writeSessionArtifact, type SessionArtifact } from '../src/state/store';

const TRANSCRIPTS_DIR = '../content/transcripts';
const WIKI_DIR = '../content/wiki';
const SESSIONS_DIR = 'state/sessions';

function toIsoDate(d: string): string {
  return d.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_m, y, mo, da) => `${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`);
}

async function main() {
  const arc = process.argv[2];
  const dateArg = process.argv[3];
  if (!arc || !dateArg) {
    console.error('Usage: bun scripts/ingest.ts <arc> <date>');
    process.exit(1);
  }
  const date = toIsoDate(dateArg);

  const { files } = await discoverTranscripts(TRANSCRIPTS_DIR);
  const file = files.find((f) => f.campaignName === arc && f.sessionDate === date);
  if (!file) {
    console.error(`No transcript for ${arc}@${date}.`);
    process.exit(1);
  }

  console.error('Loading wiki index …');
  const index = await loadWikiIndex({ contentDir: WIKI_DIR });
  console.error('Mining …');
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
  console.error('Detecting conflicts …');
  const readPage = async (p: string) => {
    const f = Bun.file(join(WIKI_DIR, p));
    return (await f.exists()) ? f.text() : null;
  };
  const c = await detectConflicts(a.proposals, { readPage });

  const artifact: SessionArtifact = {
    sessionId: { arc: file.campaignName, date: file.sessionDate },
    transcript: file.filename,
    contentHash: file.contentHash,
    generatedAt: new Date().toISOString(),
    narrative: a.narrative,
    triage: { canon: t.canon, uncertain: t.uncertain, noise: t.noise },
    proposals: a.proposals,
    entities: resolved.entities,
    needsConfirmation: resolved.needsConfirmation,
    conflicts: c.conflicts,
  };
  await writeSessionArtifact(SESSIONS_DIR, artifact);

  console.error(
    `\nWrote ${SESSIONS_DIR}/${file.campaignName}@${file.sessionDate}.json — ` +
      `${a.proposals.length} proposals (${a.proposals.filter((p) => p.kind === 'amend').length} amend / ` +
      `${a.proposals.filter((p) => p.kind === 'create').length} create), ${c.conflicts.length} conflicts.`,
  );
  process.exit(0);
}

await main();
