// Shared test fixtures for the bot-step tests (open-session / poll / redraft / canonize). Builds a
// SessionArtifact + a full BotDeps wired to in-memory fakes. Not a *.test.ts (it's imported, not run).

import type { SessionId } from '@faerrin/heartwood/src/state/identity';
import type { SessionArtifact } from '@faerrin/heartwood/src/state/store';
import { FakeGh } from './gh';
import { FakeJj } from './jj';
import {
  defaultBranchFor,
  FakeArtifacts,
  FakeBranchWriter,
  FakeLedger,
  type BotDeps,
} from './deps';

export const SID: SessionId = { arc: 'through-a-song-darkly', date: '2025-08-28' };

export function cite(transcript: string, start: number, end = start) {
  return { transcript, start, end };
}

type Proposal = SessionArtifact['proposals'][number];
type Conflict = SessionArtifact['conflicts'][number];

export function makeProposal(
  over: Partial<Proposal> & { id: string; canonicalName: string },
): Proposal {
  return {
    kind: 'amend',
    status: 'existing',
    entityId: over.entityId ?? `ent:${over.id}`,
    targetPath: `wiki/${over.canonicalName}.md`,
    facts: over.facts ?? [
      { claimId: `${over.id}:c1`, text: 'a fact', citations: [cite('t', 1)], modality: 'gm-stated' },
      { claimId: `${over.id}:c2`, text: 'a second fact', citations: [cite('t', 2)], modality: 'gm-stated' },
    ],
    ...over,
  } as Proposal;
}

export function makeConflict(over: Partial<Conflict> & { claimId: string; entityId: string }): Conflict {
  return {
    canonicalName: 'Iomenei',
    newStatement: 'founded earlier than recorded',
    existingStatement: 'founded in 1200',
    source: 'wiki',
    sourceRef: 'wiki/Iomenei.md',
    explanation: 'date mismatch',
    ...over,
  } as Conflict;
}

export function makeArtifact(over: Partial<SessionArtifact> = {}): SessionArtifact {
  return {
    sessionId: SID,
    transcript: 'through-a-song-darkly@2025-08-28.md',
    contentHash: 'deadbeef',
    generatedAt: '2026-06-06T00:00:00.000Z',
    narrative: 'The docks changed hands by morning.',
    triage: { canon: [], uncertain: [], noise: [] },
    proposals: [],
    entities: [],
    needsConfirmation: [],
    conflicts: [],
    ...over,
  };
}

export interface Harness {
  deps: BotDeps;
  gh: FakeGh;
  jj: FakeJj;
  ledger: FakeLedger;
  artifacts: FakeArtifacts;
  writer: FakeBranchWriter;
}

/** Build a full BotDeps over fakes. `draft` echoes a deterministic in-voice passage per page so
 *  tests can assert prose flow; pass `draftFn` to capture/customize. `verify` defaults to ok. */
export function makeHarness(opts: {
  artifact?: SessionArtifact;
  reviewerLogin?: string;
  draftFn?: BotDeps['draft'];
  verify?: BotDeps['verifyBuild'];
  now?: () => string;
} = {}): Harness {
  const gh = new FakeGh();
  const jj = new FakeJj();
  const ledger = new FakeLedger();
  const artifacts = new FakeArtifacts();
  const writer = new FakeBranchWriter();
  if (opts.artifact) artifacts.set(opts.artifact);

  const draft: BotDeps['draft'] =
    opts.draftFn ??
    (async (input) => ({
      draft: `In-voice draft for ${input.canonicalName}${input.instructions ? ` [note: ${input.instructions}]` : ''}.`,
    }));

  const deps: BotDeps = {
    gh,
    jj,
    ledger,
    artifacts,
    draft,
    writeBranch: writer.write,
    verifyBuild: opts.verify ?? (async () => ({ ok: true })),
    reviewerLogin: opts.reviewerLogin ?? 'josh',
    base: 'main',
    branchFor: defaultBranchFor,
    now: opts.now ?? (() => '2026-06-06T10:00:00.000Z'),
  };
  return { deps, gh, jj, ledger, artifacts, writer };
}
