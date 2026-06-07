// The bot orchestrator + one-shot CLI (NLSpec 0002 §4 "local bot", D-1). THIS IS THE UN-UNIT-TESTED
// BOUNDARY: it wires the fake-tested decision steps (openSession/pollOnce/redraftBatch/canonize) to
// REAL gh/jj/ledger/artifact/draft I/O. Run it on an external timer (cron/systemd) as `tick` — each
// tick is idempotent (AC-13), so a crash is just a skipped tick (no daemon to wedge).
//
// `writeBranch` is now WIRED (bot-impl.makeWriteBranch). ONE host-specific piece remains gated:
// `verifyBuild`'s `expectedChanged` (the wiki-page → built-aether-output path map for the 763-file
// guard, AC-21) — it needs aether's slug logic confirmed on the host (open-decision #2). So the bot
// can write/poll/redraft for real; only canonize's build guard throws until that map is wired.

import {
  readReviewState,
  writeReviewState,
} from '@faerrin/heartwood/src/state/review';
import { readSessionArtifact } from '@faerrin/heartwood/src/state/store';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import { draftProse } from '@faerrin/heartwood/src/pipeline/draft';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PROV_ROOT, REPO_ROOT, REVIEW_DIR, SESSIONS_DIR, WIKI_DIR } from '@faerrin/heartwood-review/src/server/paths';
import { makeGhClient } from './gh';
import { makeJjClient } from './jj';
import { defaultBranchFor, type BotDeps } from './deps';
import { makeVerifyBuild, makeWriteBranch, realReadBaseFile, realRunJj } from './bot-impl';
import { openSession } from './open-session';
import { pollOnce } from './poll';
import { redraftBatch } from './redraft';
import { canonize } from './canonize';

const execFileAsync = promisify(execFile);

/** Build real BotDeps. `reviewerLogin` comes from $HEARTWOOD_REVIEWER_LOGIN (the D-3 allowlist). */
export function realDeps(): BotDeps {
  const reviewerLogin = process.env.HEARTWOOD_REVIEWER_LOGIN;
  if (!reviewerLogin) throw new Error('set HEARTWOOD_REVIEWER_LOGIN (the allowlisted reviewer, D-3)');
  const base = 'main';
  return {
    gh: makeGhClient(REPO_ROOT),
    jj: makeJjClient(REPO_ROOT),
    ledger: {
      read: (sid) => readReviewState(REVIEW_DIR, sid),
      write: (_sid, state) => writeReviewState(REVIEW_DIR, state),
    },
    artifacts: { read: (sid) => readSessionArtifact(SESSIONS_DIR, sid) },
    draft: (input) => draftProse(input),
    writeBranch: makeWriteBranch({
      wikiDir: WIKI_DIR,
      provRoot: PROV_ROOT,
      sessionsDir: SESSIONS_DIR,
      base,
      readBaseFile: realReadBaseFile(REPO_ROOT, base),
      runJj: realRunJj(REPO_ROOT),
    }),
    verifyBuild: makeVerifyBuild({
      runBuild: async () => {
        await execFileAsync('bun', ['--filter', '@faerrin/aether', 'build'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
      },
      changedBuildPaths: async () => {
        const { stdout } = await execFileAsync('jj', ['--no-pager', 'diff', '--summary', 'pkg/aether/public'], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
        return stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^[A-Z]\s+/, ''));
      },
      expectedChanged: () => {
        // GATED (open-decision #2): the wiki-page → built-aether-output path map needs aether's slug
        // logic confirmed on the host before the 763-file guard can name the allowed changes.
        throw new Error(
          'verifyBuild.expectedChanged is the last gated piece (the wiki→built-path map for the ' +
            '763-file guard, AC-21): wire it on the host. See heartwood-pr-phase-b-open-decisions.md (#2).',
        );
      },
    }),
    reviewerLogin,
    base,
    branchFor: defaultBranchFor,
    now: () => new Date().toISOString(),
  };
}

/** One idempotent tick: poll commands/checkboxes → re-draft any flagged pages → try to canonize. */
export async function tick(sid: SessionId, deps: BotDeps): Promise<void> {
  const polled = await pollOnce(sid, deps);
  if (polled.ok && polled.redraftPages.length > 0) {
    await redraftBatch(sid, deps, polled.redraftPages);
  }
  await canonize(sid, deps); // no-op until the reviewer merges
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function parseSid(arc: string | undefined, date: string | undefined): SessionId {
  if (!arc || !date) throw new Error('usage: bot <open|poll|tick|canonize> <arc> <date>');
  return { arc, date };
}

async function main(): Promise<void> {
  const [cmd, arc, date] = process.argv.slice(2);
  const deps = realDeps();
  const sid = parseSid(arc, date);
  switch (cmd) {
    case 'open':
      console.log(JSON.stringify(await openSession(sid, deps), null, 2));
      break;
    case 'poll':
      console.log(JSON.stringify(await pollOnce(sid, deps), null, 2));
      break;
    case 'tick':
      await tick(sid, deps);
      break;
    case 'canonize':
      console.log(JSON.stringify(await canonize(sid, deps), null, 2));
      break;
    default:
      throw new Error('usage: bot <open|poll|tick|canonize> <arc> <date>');
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
