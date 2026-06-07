// The bot orchestrator + one-shot CLI (NLSpec 0002 §4 "local bot", D-1). THIS IS THE UN-UNIT-TESTED
// BOUNDARY: it wires the fake-tested decision steps (openSession/pollOnce/redraftBatch/canonize) to
// REAL gh/jj/ledger/artifact/draft I/O. Run it on an external timer (cron/systemd) as `tick` — each
// tick is idempotent (AC-13), so a crash is just a skipped tick (no daemon to wedge).
//
// Two deps stay GATED on the worldbuilder (Phase C) and THROW until wired, by design — so the bot can
// never silently do the wrong thing before the Phase-0 spike settles them (see the
// heartwood-pr-phase-b-open-decisions memory):
//   - writeBranch: write drafted prose + the provenance sidecar to the branch as one additive jj
//     revision WITHOUT setting committedAt (the page-write core of performCommit, minus the
//     committedAt/lock acts). Needs the spike-confirmed prose representation + provenance wiring.
//   - verifyBuild: the 763-file aether build + file-set diff guard (AC-21) — needs the build command
//     + the recorded baseline confirmed on the host.

import {
  readReviewState,
  writeReviewState,
} from '@faerrin/heartwood/src/state/review';
import { readSessionArtifact } from '@faerrin/heartwood/src/state/store';
import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import { draftProse } from '@faerrin/heartwood/src/pipeline/draft';
import { REPO_ROOT, REVIEW_DIR, SESSIONS_DIR } from '@faerrin/heartwood-review/src/server/paths';
import { makeGhClient } from './gh';
import { makeJjClient } from './jj';
import { defaultBranchFor, type BotDeps } from './deps';
import { openSession } from './open-session';
import { pollOnce } from './poll';
import { redraftBatch } from './redraft';
import { canonize } from './canonize';

function gated(name: string): never {
  throw new Error(
    `${name} is the worldbuilder-gated boundary (Phase C): wire it on the host after the Phase-0 ` +
      `sanitizer spike + build-guard baseline are settled. See thoughts/shared/memory/` +
      `heartwood-pr-phase-b-open-decisions.md.`,
  );
}

/** Build real BotDeps. `reviewerLogin` comes from $HEARTWOOD_REVIEWER_LOGIN (the D-3 allowlist). */
export function realDeps(): BotDeps {
  const reviewerLogin = process.env.HEARTWOOD_REVIEWER_LOGIN;
  if (!reviewerLogin) throw new Error('set HEARTWOOD_REVIEWER_LOGIN (the allowlisted reviewer, D-3)');
  return {
    gh: makeGhClient(REPO_ROOT),
    jj: makeJjClient(REPO_ROOT),
    ledger: {
      read: (sid) => readReviewState(REVIEW_DIR, sid),
      write: (_sid, state) => writeReviewState(REVIEW_DIR, state),
    },
    artifacts: { read: (sid) => readSessionArtifact(SESSIONS_DIR, sid) },
    draft: (input) => draftProse(input),
    writeBranch: () => gated('writeBranch'),
    verifyBuild: () => gated('verifyBuild'),
    reviewerLogin,
    base: 'main',
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
