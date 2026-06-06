// Per-session artifact store (plan Phase 1 §1 / Phase 2). The headless pipeline
// (mine → triage → resolve → assemble → conflict) is expensive and LLM-backed, so
// it runs once via the `ingest` CLI and persists a SessionArtifact; the review app
// reads these artifacts (it never re-mines on a page load). node:fs throughout so
// the app can read under Node (server fns run under Node, not Bun).
//
// Identity is structural (C8): the artifact is keyed by (arc, date), and carries the
// transcript filename + contentHash for idempotent re-ingest (C9).

import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';
import { writeFileAtomic } from './atomic';
import { sessionKey, type SessionId } from './identity';
import { ClaimSchema, CitationSchema } from '../pipeline/types';
import type { Proposal, ProposalFact } from '../pipeline/assemble';
import type { ResolvedEntity } from '../pipeline/resolve';
import type { Conflict } from '../pipeline/conflict';

const SessionIdSchema = z.object({ arc: z.string(), date: z.string() });

const ProposalFactSchema = z.object({
  claimId: z.string(),
  text: z.string(),
  citations: z.array(CitationSchema),
  modality: ClaimSchema.shape.modality,
});

const ProposalSchema = z.object({
  id: z.string(),
  kind: z.enum(['amend', 'create']),
  status: z.enum(['existing', 'new']),
  entityId: z.string(),
  canonicalName: z.string(),
  targetPath: z.string().nullable(),
  facts: z.array(ProposalFactSchema),
});

const ResolvedEntitySchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()),
  wikiPath: z.string().nullable(),
  status: z.enum(['known', 'pending']),
  confidence: z.enum(['high', 'low']),
});

const ConflictSchema = z.object({
  claimId: z.string(),
  entityId: z.string(),
  canonicalName: z.string(),
  newStatement: z.string(),
  existingStatement: z.string(),
  source: z.literal('wiki'),
  sourceRef: z.string(),
  explanation: z.string(),
});

export const SessionArtifactSchema = z.object({
  sessionId: SessionIdSchema,
  transcript: z.string(), // filename
  contentHash: z.string(),
  generatedAt: z.string(), // ISO
  narrative: z.string(),
  triage: z.object({
    canon: z.array(ClaimSchema),
    uncertain: z.array(ClaimSchema),
    noise: z.array(ClaimSchema),
  }),
  proposals: z.array(ProposalSchema),
  entities: z.array(ResolvedEntitySchema),
  needsConfirmation: z.array(ResolvedEntitySchema),
  conflicts: z.array(ConflictSchema),
});
export type SessionArtifact = z.infer<typeof SessionArtifactSchema>;

// Drift guards: these assignments fail to compile if a pipeline interface diverges
// from its persistence schema, forcing the schema to be updated in lockstep.
const _factCheck = (f: ProposalFact): z.infer<typeof ProposalFactSchema> => f;
const _propCheck = (p: Proposal): z.infer<typeof ProposalSchema> => p;
const _entCheck = (e: ResolvedEntity): z.infer<typeof ResolvedEntitySchema> => e;
const _conflictCheck = (c: Conflict): z.infer<typeof ConflictSchema> => c;
void _factCheck;
void _propCheck;
void _entCheck;
void _conflictCheck;

/** Artifact file path for a session under `dir` (e.g. `<pkg>/state/sessions`). */
export function sessionArtifactPath(dir: string, id: SessionId): string {
  return join(dir, `${sessionKey(id)}.json`);
}

export async function writeSessionArtifact(dir: string, artifact: SessionArtifact): Promise<void> {
  const validated = SessionArtifactSchema.parse(artifact);
  await writeFileAtomic(
    sessionArtifactPath(dir, validated.sessionId),
    JSON.stringify(validated, null, 2),
  );
}

/** Read a session artifact, or null if it hasn't been ingested. */
export async function readSessionArtifact(dir: string, id: SessionId): Promise<SessionArtifact | null> {
  let text: string;
  try {
    text = await readFile(sessionArtifactPath(dir, id), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return SessionArtifactSchema.parse(JSON.parse(text));
}

export interface SessionSummary {
  sessionId: SessionId;
  transcript: string;
  generatedAt: string;
  /** Proposal ids — carried so callers can compute review status without re-reading. */
  proposalIds: string[];
  proposalCount: number;
  conflictCount: number;
}

/** List ingested sessions (lightweight summaries) under `dir`, newest date first. */
export async function listSessionArtifacts(dir: string): Promise<SessionSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: SessionSummary[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const parsed = SessionArtifactSchema.safeParse(
      JSON.parse(await readFile(join(dir, name), 'utf8')),
    );
    if (!parsed.success) continue;
    const a = parsed.data;
    out.push({
      sessionId: a.sessionId,
      transcript: a.transcript,
      generatedAt: a.generatedAt,
      proposalIds: a.proposals.map((p) => p.id),
      proposalCount: a.proposals.length,
      conflictCount: a.conflicts.length,
    });
  }
  out.sort((x, y) => y.sessionId.date.localeCompare(x.sessionId.date) || x.sessionId.arc.localeCompare(y.sessionId.arc));
  return out;
}
