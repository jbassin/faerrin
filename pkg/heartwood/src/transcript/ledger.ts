import { z } from 'zod';
import type { TranscriptFile } from './discover';
import { writeFileAtomic } from '../state/atomic';
import { sessionKey, type SessionId } from '../state/identity';

// Per-session processing ledger (spec C8/C9, AC-25). Keyed by (arc, date) — never the
// filename stem (the `000` arc reuses one basename). Each session tracks a contentHash and
// per-stage timestamps; on a hash change reconcile() clears the stages so it re-runs, and
// already-approved facts are guarded downstream (provenance), not re-proposed.

export const STAGE_ORDER = [
  'mined',
  'triaged',
  'resolved',
  'located',
  'conflicted',
  'assembled',
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

export const StagesSchema = z.object({
  mined:      z.string().nullable(),
  triaged:    z.string().nullable(),
  resolved:   z.string().nullable(),
  located:    z.string().nullable(),
  conflicted: z.string().nullable(),
  assembled:  z.string().nullable(),
});

export const ErrorRecordSchema = z.object({
  stage:   z.enum(STAGE_ORDER),
  ts:      z.string(),
  message: z.string(),
});

export const SessionIdSchema = z.object({ arc: z.string(), date: z.string() });

export const LedgerEntrySchema = z.object({
  session:     SessionIdSchema,
  filename:    z.string(),   // retained for display/citations
  contentHash: z.string(),
  stages:      StagesSchema,
  errors:      z.array(ErrorRecordSchema),
});

export const LedgerSchema = z.object({
  entries: z.array(LedgerEntrySchema),
});

export type Stages = z.infer<typeof StagesSchema>;
export type ErrorRecord = z.infer<typeof ErrorRecordSchema>;
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type Ledger = z.infer<typeof LedgerSchema>;

export const EMPTY_STAGES: Stages = {
  mined: null, triaged: null, resolved: null, located: null, conflicted: null, assembled: null,
};

export function emptyLedger(): Ledger {
  return { entries: [] };
}

function entryKey(e: LedgerEntry): string {
  return sessionKey(e.session);
}

// ---- IO ----

export async function readLedger(path: string): Promise<Ledger> {
  const file = Bun.file(path);
  if (!(await file.exists())) return emptyLedger();
  return LedgerSchema.parse(JSON.parse(await file.text()));
}

export async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(ledger, null, 2) + '\n');
}

// ---- Reconcile ----

export interface ReconcileChanges {
  added:     string[];   // session keys newly appearing in discovery
  unchanged: string[];   // present, hash matches
  rehashed:  string[];   // present, hash differs — entry kept but stages cleared (AC-25)
  missing:   string[];   // ledger entry has no transcript in current discovery
}

export interface ReconcileResult {
  ledger:  Ledger;
  changes: ReconcileChanges;
}

function sessionOf(f: TranscriptFile): SessionId {
  return { arc: f.campaignName, date: f.sessionDate };
}

export function reconcile(prior: Ledger, discovered: TranscriptFile[]): ReconcileResult {
  const byKey = new Map<string, LedgerEntry>();
  for (const e of prior.entries) byKey.set(entryKey(e), e);

  const discoveredKeys = new Set(discovered.map((f) => sessionKey(sessionOf(f))));
  const changes: ReconcileChanges = { added: [], unchanged: [], rehashed: [], missing: [] };
  const nextEntries: LedgerEntry[] = [];

  for (const f of discovered) {
    const session = sessionOf(f);
    const key = sessionKey(session);
    const existing = byKey.get(key);
    if (!existing) {
      nextEntries.push({ session, filename: f.filename, contentHash: f.contentHash, stages: { ...EMPTY_STAGES }, errors: [] });
      changes.added.push(key);
    } else if (existing.contentHash === f.contentHash) {
      nextEntries.push(existing);
      changes.unchanged.push(key);
    } else {
      nextEntries.push({ session, filename: f.filename, contentHash: f.contentHash, stages: { ...EMPTY_STAGES }, errors: [] });
      changes.rehashed.push(key);
    }
  }

  // Preserve orphan entries (transcript removed from disk) so we don't lose history.
  for (const e of prior.entries) {
    if (!discoveredKeys.has(entryKey(e))) {
      nextEntries.push(e);
      changes.missing.push(entryKey(e));
    }
  }

  return { ledger: { entries: nextEntries }, changes };
}

// ---- Lookup ----

export type FindResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: string[] };

export function findBySession(ledger: Ledger, session: SessionId): LedgerEntry | undefined {
  const key = sessionKey(session);
  return ledger.entries.find((e) => entryKey(e) === key);
}

/** Loose lookup for CLI ergonomics: matches against `arc@date`, arc, or filename substring. */
export function findEntry(ledger: Ledger, query: string): FindResult {
  const exact = ledger.entries.find((e) => entryKey(e) === query);
  if (exact) return { ok: true, entry: exact };

  const matches = ledger.entries.filter(
    (e) => entryKey(e).includes(query) || e.filename.includes(query),
  );
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length === 1) return { ok: true, entry: matches[0]! };
  return { ok: false, reason: 'ambiguous', candidates: matches.map(entryKey) };
}

// ---- Mutations (all return a new ledger) ----

function replaceEntry(ledger: Ledger, key: string, fn: (e: LedgerEntry) => LedgerEntry): Ledger {
  return { entries: ledger.entries.map((e) => (entryKey(e) === key ? fn(e) : e)) };
}

export function markStage(ledger: Ledger, session: SessionId, stage: Stage, ts = new Date().toISOString()): Ledger {
  return replaceEntry(ledger, sessionKey(session), (e) => ({
    ...e,
    stages: { ...e.stages, [stage]: ts },
    errors: e.errors.filter((err) => err.stage !== stage),
  }));
}

export function recordError(ledger: Ledger, session: SessionId, stage: Stage, message: string, ts = new Date().toISOString()): Ledger {
  return replaceEntry(ledger, sessionKey(session), (e) => ({
    ...e,
    errors: [...e.errors, { stage, ts, message }],
  }));
}

export function resetEntryStage(ledger: Ledger, session: SessionId, stage: Stage): Ledger {
  const startIdx = STAGE_ORDER.indexOf(stage);
  if (startIdx < 0) throw new Error(`unknown stage: ${stage}`);
  const cleared = new Set<Stage>(STAGE_ORDER.slice(startIdx));
  return replaceEntry(ledger, sessionKey(session), (e) => {
    const stages: Stages = { ...e.stages };
    for (const s of cleared) stages[s] = null;
    return { ...e, stages, errors: e.errors.filter((err) => !cleared.has(err.stage)) };
  });
}
