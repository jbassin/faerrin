// Phase C host wiring (NLSpec 0002 §15 Phase-0c): the REAL `writeBranch` + `verifyBuild` that the
// thin `bot.ts` CLI injects. SERVER-ONLY (node:fs + jj + the aether build). The file logic is DI'd
// so it is unit-tested against a temp tree + fake jj; only the DEFAULT deps (real jj, base-file read,
// aether build) hit the host — those are the worldbuilder's product-bet validation (a real PR
// round-trip + the byte-stable 763-file build), which can't be asserted offline.

import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { readSessionArtifact, type SessionArtifact } from '@faerrin/heartwood/src/state/store';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import { writeFileAtomic } from '@faerrin/heartwood/src/state/atomic';
import { readPageProvenance, writePageProvenance } from '@faerrin/heartwood/src/state/provenance';
import { replacePageBody, splitFrontmatter } from '@faerrin/heartwood-review/src/lib/page-body';
import {
  appendAuthoredParagraph,
  commitMessage,
  newPageContent,
  normalizeWikiPath,
} from '@faerrin/heartwood-review/src/server/commit';
import { writeProvenanceFor } from '@faerrin/heartwood-review/src/server/commit-impl';
import { within } from '@faerrin/heartwood-review/src/server/paths';
import type { BranchWriteResult, PageWrite, VerifyBuild, WriteBranch } from './deps';

const execFileAsync = promisify(execFile);

type Proposal = SessionArtifact['proposals'][number];

/** The wiki path a proposal targets: its `targetPath` (amend) or a name-derived path (create). */
function wikiPathFor(p: Proposal): string | null {
  if (p.kind === 'amend') return p.targetPath ?? null;
  return normalizeWikiPath(p.canonicalName); // creates land at the wiki root by name; reviewer can move it
}

export interface BranchWriteDeps {
  wikiDir: string;
  provRoot: string;
  sessionsDir: string;
  base: string; // the ref a removed amend is reverted to (e.g. 'main')
  /** Page content at `base` (real: `jj file show -r <base> <path>`); null if it didn't exist there. */
  readBaseFile: (relPath: string) => Promise<string | null>;
  /** jj runner (real: execFile jj); used only for the single path-scoped commit. */
  runJj: (args: string[]) => Promise<string>;
}

/** Drop this session's provenance records from a page sidecar (so a re-draft doesn't duplicate them,
 *  and a remove erases them). Returns the content-relative sidecar path. */
async function stripSessionProvenance(provRoot: string, wikiPath: string, sid: SessionId): Promise<void> {
  const prov = await readPageProvenance(provRoot, wikiPath);
  const kept = prov.records.filter((r) => !(r.session.arc === sid.arc && r.session.date === sid.date));
  if (kept.length !== prov.records.length) await writePageProvenance(provRoot, { wikiPath, records: kept });
}

/**
 * Build the real `writeBranch` (NLSpec 0002 D-14): weave each drafted passage into its page + write
 * the provenance sidecar, create new pages, revert/delete removed ones, then ONE path-scoped jj
 * commit — WITHOUT setting `committedAt` (canon happens only on merge, AC-4/AC-21). Re-draft-safe:
 * an amend is always rebuilt from the BASE page (+ the fresh passage), and this session's prior
 * provenance is stripped first, so repeated redrafts don't stack prose or duplicate records.
 */
export function makeWriteBranch(deps: BranchWriteDeps): WriteBranch {
  return async (sid: SessionId, pages: PageWrite[]): Promise<BranchWriteResult> => {
    const artifact = await readSessionArtifact(deps.sessionsDir, sid);
    if (!artifact) throw new Error(`session ${sid.arc}@${sid.date} not ingested`);
    const byId = new Map(artifact.proposals.map((p) => [p.id, p]));

    const written: string[] = [];
    let amend = 0;
    let create = 0;

    for (const pw of pages) {
      const p = byId.get(pw.proposalId);
      if (!p) continue;
      const wikiPath = wikiPathFor(p);
      if (!wikiPath) continue;
      const abs = within(deps.wikiDir, wikiPath);
      const wikiRel = `pkg/content/wiki/${wikiPath}`;
      const provRel = `pkg/content/.heartwood/provenance/${wikiPath}.prov.json`;

      if ((pw.action ?? 'write') === 'remove') {
        if (p.kind === 'create') {
          await rm(abs, { force: true });
        } else {
          const baseRaw = await deps.readBaseFile(wikiPath);
          if (baseRaw !== null) await writeFileAtomic(abs, baseRaw); // restore the pre-session page
        }
        await stripSessionProvenance(deps.provRoot, wikiPath, sid);
        written.push(wikiRel, provRel);
        continue;
      }

      // write: always rebuild from the base page so redrafts don't stack (D-14).
      await stripSessionProvenance(deps.provRoot, wikiPath, sid);
      if (p.kind === 'amend') {
        const baseRaw = (await deps.readBaseFile(wikiPath)) ?? (await readFile(abs, 'utf8'));
        const woven = appendAuthoredParagraph(splitFrontmatter(baseRaw).body, pw.prose);
        const newRaw = replacePageBody(baseRaw, woven);
        await writeFileAtomic(abs, newRaw);
        const sc = await writeProvenanceFor(deps.provRoot, wikiPath, newRaw, baseRaw, p, sid);
        written.push(wikiRel);
        if (sc) written.push(sc);
        amend++;
      } else {
        const newRaw = newPageContent(pw.prose);
        await writeFileAtomic(abs, newRaw);
        const sc = await writeProvenanceFor(deps.provRoot, wikiPath, newRaw, '', p, sid);
        written.push(wikiRel);
        if (sc) written.push(sc);
        create++;
      }
    }

    if (written.length === 0) return { revision: '', written: [] };
    // One path-scoped jj revision with exactly these files (NOT setting committedAt — merge does that).
    const message = commitMessage(sid.arc, sid.date, amend, create, 0);
    await deps.runJj(['commit', '-m', message, ...written]);
    const revision = (await deps.runJj(['log', '-r', '@-', '--no-graph', '-T', 'commit_id.short()'])).trim();
    return { revision, written };
  };
}

// ── verifyBuild: the 763-file aether build + diff guard (AC-21) ──────────────────────────────────

export interface VerifyBuildDeps {
  /** Run the aether build (real: `bun --filter @faerrin/aether build`). Throws on build failure. */
  runBuild: () => Promise<void>;
  /** Content-relative paths that changed in the build output vs the committed baseline. */
  changedBuildPaths: () => Promise<string[]>;
  /** The paths this session is allowed to have changed (its pages' rendered output + nothing else). */
  expectedChanged: (sid: SessionId) => Promise<string[]>;
}

/**
 * Build the real `verifyBuild` (AC-21): run the aether build, then assert ONLY this session's pages
 * changed in the output — the renderer + the other 763 files must be byte-identical (C6). Any
 * unexpected change FAILS, which blocks canonization (the caller never sets committedAt / releases
 * the lock). The expected-set + baseline are host-specific; this is the worldbuilder's gate.
 */
export function makeVerifyBuild(deps: VerifyBuildDeps): VerifyBuild {
  return async (sid: SessionId) => {
    try {
      await deps.runBuild();
    } catch (err) {
      return { ok: false, reason: `aether build failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    const changed = await deps.changedBuildPaths();
    const expected = new Set(await deps.expectedChanged(sid));
    const unexpected = changed.filter((p) => !expected.has(p));
    if (unexpected.length > 0) {
      return { ok: false, reason: `${unexpected.length} unexpected build file(s) changed: ${unexpected.slice(0, 5).join(', ')}` };
    }
    return { ok: true };
  };
}

// ── Real default deps (host boundary — not exercised in tests) ───────────────────────────────────

/** Real jj runner over execFile (no shell), rooted at `repoRoot`. */
export function realRunJj(repoRoot: string): (args: string[]) => Promise<string> {
  return async (args) => {
    const { stdout } = await execFileAsync('jj', ['--no-pager', ...args], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
}

/** Real base-file reader: the page content at `base` via `jj file show` (null if absent there). */
export function realReadBaseFile(repoRoot: string, base: string): (relPath: string) => Promise<string | null> {
  const run = realRunJj(repoRoot);
  return async (relPath) => {
    try {
      return await run(['file', 'show', '-r', base, `pkg/content/wiki/${relPath}`]);
    } catch {
      return null; // didn't exist at base (a genuinely new page being reverted is a no-op)
    }
  };
}
