// The bot's dependency seam (NLSpec 0002 §6.3). Every bot STEP (openSession/pollOnce/redraftBatch/
// canonize) takes `BotDeps` so its decision logic is unit-testable against fakes with no GitHub, no
// jj, no LLM, no filesystem. The thin real `bot.ts` (the un-unit-tested boundary) wires the real
// GhClient/JjClient + real ledger/artifact I/O + draftProse + the performCommit-backed branch write.

import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import {
  emptyReviewState,
  type ReviewState,
} from '@faerrin/heartwood/src/state/review';
import type { SessionArtifact } from '@faerrin/heartwood/src/state/store';
import type { DraftInput } from '@faerrin/heartwood/src/pipeline/draft';
import type { GhClient } from './gh';
import type { JjClient } from './jj';

/** Shared-ledger I/O (real impl wraps readReviewState/writeReviewState over a dir). */
export interface LedgerIO {
  read(sid: SessionId): Promise<ReviewState>;
  write(sid: SessionId, state: ReviewState): Promise<void>;
}

/** Session-artifact reader (real impl wraps readSessionArtifact). */
export interface ArtifactIO {
  read(sid: SessionId): Promise<SessionArtifact | null>;
}

/** One page's reconciliation to the branch this pass. */
export interface PageWrite {
  proposalId: string;
  prose: string;
  /**
   * `'write'` (default) writes the drafted prose; `'remove'` reverts the page to its pre-session
   * state (amend → drop the woven passage; create → delete the new page). A rejected/emptied page
   * MUST be removed so it never reaches the merge tree (AC-26/AC-8). The fake records the action; the
   * real (gated) writeBranch performs it.
   */
  action?: 'write' | 'remove';
}

export interface BranchWriteResult {
  /** The new jj revision id the additive write produced (becomes `lastBotBookmarkTarget`). */
  revision: string;
  /** Content-relative paths written (pages + provenance sidecars). */
  written: string[];
}

/**
 * Write the given pages' prose + provenance to the wiki working tree and create ONE additive jj
 * revision — WITHOUT setting `committedAt` (that is the canonizer's act on merge, AC-21). The real
 * impl reuses `replacePageBody` + the provenance writer from commit-impl (the page-write core, minus
 * the committedAt/lock acts); the fake records the write and returns a synthetic revision id.
 */
export type WriteBranch = (sid: SessionId, pages: PageWrite[]) => Promise<BranchWriteResult>;

export interface BuildVerification {
  ok: boolean;
  /** Why verification failed (canonization is blocked; committedAt stays unset, AC-21). */
  reason?: string;
}

/**
 * The 763-file aether build + file-set diff guard (AC-21, NEW code — not a reuse). Real impl runs the
 * aether build and asserts only the session's touched pages + sidecars differ; the fake returns a
 * canned result. Failure blocks canonization.
 */
export type VerifyBuild = (sid: SessionId) => Promise<BuildVerification>;

export interface BotDeps {
  gh: GhClient;
  jj: JjClient;
  ledger: LedgerIO;
  artifacts: ArtifactIO;
  draft: (input: DraftInput) => Promise<{ draft: string }>;
  writeBranch: WriteBranch;
  verifyBuild: VerifyBuild;
  /** The single allowlisted reviewer login — commands from anyone else are ignored (D-3, AC-14). */
  reviewerLogin: string;
  /** The PR base branch (e.g. `main`). */
  base: string;
  /** `(arc,date)` → the session bookmark name `hw/<arc>-<date>` (C1). */
  branchFor: (sid: SessionId) => string;
  /** Injectable ISO clock (testable timestamps). */
  now: () => string;
}

/** Default `(arc,date)` → `hw/<arc>-<date>` (one bookmark/PR per session, C1). */
export function defaultBranchFor(sid: SessionId): string {
  return `hw/${sid.arc}-${sid.date}`;
}

// ── In-memory fakes for step tests ───────────────────────────────────────────────────────────────

/** In-memory `LedgerIO` keyed by session. */
export class FakeLedger implements LedgerIO {
  private store = new Map<string, ReviewState>();
  private key(sid: SessionId): string {
    return `${sid.arc}@${sid.date}`;
  }
  async read(sid: SessionId): Promise<ReviewState> {
    return this.store.get(this.key(sid)) ?? emptyReviewState(sid);
  }
  async write(sid: SessionId, state: ReviewState): Promise<void> {
    this.store.set(this.key(sid), state);
  }
  /** Test seam: pre-seed a state (e.g. the web app already holds the lock). */
  seed(sid: SessionId, state: ReviewState): void {
    this.store.set(this.key(sid), state);
  }
}

/** In-memory `ArtifactIO`. */
export class FakeArtifacts implements ArtifactIO {
  private store = new Map<string, SessionArtifact>();
  private key(sid: SessionId): string {
    return `${sid.arc}@${sid.date}`;
  }
  async read(sid: SessionId): Promise<SessionArtifact | null> {
    return this.store.get(this.key(sid)) ?? null;
  }
  set(artifact: SessionArtifact): void {
    this.store.set(this.key(artifact.sessionId), artifact);
  }
}

/**
 * A fake `writeBranch` that records every page write and returns an incrementing synthetic revision.
 * Use `.calls` to assert which pages were written each pass; `.nextRevision` is the id it will
 * return next (lets a test predict `lastBotBookmarkTarget`).
 */
export class FakeBranchWriter {
  readonly calls: { sid: SessionId; pages: PageWrite[] }[] = [];
  private rev = 0;
  readonly write: WriteBranch = async (sid, pages) => {
    this.calls.push({ sid, pages });
    return { revision: `rev${++this.rev}`, written: pages.map((p) => `wiki/${p.proposalId}.md`) };
  };
  get lastRevision(): string {
    return `rev${this.rev}`;
  }
}
