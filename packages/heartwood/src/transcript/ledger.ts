import { rename } from 'node:fs/promises';
import { z } from 'zod';
import type { TranscriptFile } from './discover';

export const STAGE_ORDER = [
  'segmented',
  'extracted',
  'resolved',
  'matched',
  'proposed',
  'verified',
  'prOpened',
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

export const StagesSchema = z.object({
  segmented: z.string().nullable(),
  extracted: z.string().nullable(),
  resolved:  z.string().nullable().optional().transform((v) => v ?? null),
  matched:   z.string().nullable(),
  proposed:  z.string().nullable(),
  verified:  z.string().nullable(),
  prOpened:  z.string().nullable(),
});

export const ErrorRecordSchema = z.object({
  stage:   z.enum(STAGE_ORDER),
  ts:      z.string(),
  message: z.string(),
});

export const LedgerEntrySchema = z.object({
  filename:    z.string(),
  contentHash: z.string(),
  stages:      StagesSchema,
  prUrl:       z.string().optional(),
  mrIid:       z.number().int().positive().optional(),
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
  segmented: null, extracted: null, resolved: null, matched: null,
  proposed:  null, verified:  null, prOpened: null,
};

export function emptyLedger(): Ledger {
  return { entries: [] };
}

// ---- IO ----

export async function readLedger(path: string): Promise<Ledger> {
  const file = Bun.file(path);
  if (!(await file.exists())) return emptyLedger();
  const raw = JSON.parse(await file.text());
  return LedgerSchema.parse(raw);
}

export async function writeLedger(path: string, ledger: Ledger): Promise<void> {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(ledger, null, 2) + '\n');
  await rename(tmp, path);
}

// ---- Reconcile ----

export interface ReconcileChanges {
  added:     string[];   // new files appearing in discovery
  unchanged: string[];   // file present, hash matches existing entry
  rehashed:  string[];   // file present, hash differs — entry kept but stages cleared
  missing:   string[];   // ledger entry has no file in current discovery
}

export interface ReconcileResult {
  ledger:  Ledger;
  changes: ReconcileChanges;
}

export function reconcile(prior: Ledger, discovered: TranscriptFile[]): ReconcileResult {
  const byFilename = new Map<string, LedgerEntry>();
  for (const e of prior.entries) byFilename.set(e.filename, e);

  const discoveredNames = new Set(discovered.map((f) => f.filename));
  const changes: ReconcileChanges = { added: [], unchanged: [], rehashed: [], missing: [] };
  const nextEntries: LedgerEntry[] = [];

  for (const f of discovered) {
    const existing = byFilename.get(f.filename);
    if (!existing) {
      nextEntries.push({
        filename:    f.filename,
        contentHash: f.contentHash,
        stages:      { ...EMPTY_STAGES },
        errors:      [],
      });
      changes.added.push(f.filename);
    } else if (existing.contentHash === f.contentHash) {
      nextEntries.push(existing);
      changes.unchanged.push(f.filename);
    } else {
      nextEntries.push({
        filename:    f.filename,
        contentHash: f.contentHash,
        stages:      { ...EMPTY_STAGES },
        errors:      [],
      });
      changes.rehashed.push(f.filename);
    }
  }

  // Preserve orphan entries (file removed from disk) so we don't lose pipeline history.
  for (const e of prior.entries) {
    if (!discoveredNames.has(e.filename)) {
      nextEntries.push(e);
      changes.missing.push(e.filename);
    }
  }

  return { ledger: { entries: nextEntries }, changes };
}

// ---- Lookup ----

export type FindResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: string[] };

export function findEntry(ledger: Ledger, name: string): FindResult {
  // 1. Exact match (with or without trailing .txt)
  const withExt = name.endsWith('.txt') ? name : `${name}.txt`;
  const exact = ledger.entries.find((e) => e.filename === name || e.filename === withExt);
  if (exact) return { ok: true, entry: exact };

  // 2. Unique substring match
  const matches = ledger.entries.filter((e) => e.filename.includes(name));
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length === 1) return { ok: true, entry: matches[0]! };
  return { ok: false, reason: 'ambiguous', candidates: matches.map((e) => e.filename) };
}

// ---- Mutations (all return a new ledger) ----

function replaceEntry(ledger: Ledger, filename: string, fn: (e: LedgerEntry) => LedgerEntry): Ledger {
  return {
    entries: ledger.entries.map((e) => (e.filename === filename ? fn(e) : e)),
  };
}

export function markStage(ledger: Ledger, filename: string, stage: Stage, ts = new Date().toISOString()): Ledger {
  return replaceEntry(ledger, filename, (e) => ({
    ...e,
    stages: { ...e.stages, [stage]: ts },
    errors: e.errors.filter((err) => err.stage !== stage),
  }));
}

export function recordError(ledger: Ledger, filename: string, stage: Stage, message: string, ts = new Date().toISOString()): Ledger {
  return replaceEntry(ledger, filename, (e) => ({
    ...e,
    errors: [...e.errors, { stage, ts, message }],
  }));
}

export function setPrUrl(ledger: Ledger, filename: string, prUrl: string): Ledger {
  return replaceEntry(ledger, filename, (e) => ({ ...e, prUrl }));
}

export function setMrIid(ledger: Ledger, filename: string, mrIid: number): Ledger {
  return replaceEntry(ledger, filename, (e) => ({ ...e, mrIid }));
}

export function resetEntry(ledger: Ledger, filename: string): Ledger {
  return replaceEntry(ledger, filename, (e) => ({
    filename: e.filename,
    contentHash: e.contentHash,
    stages: { ...EMPTY_STAGES },
    errors: [],
    // prUrl explicitly omitted
  }));
}

export function resetEntryStage(ledger: Ledger, filename: string, stage: Stage): Ledger {
  const startIdx = STAGE_ORDER.indexOf(stage);
  if (startIdx < 0) throw new Error(`unknown stage: ${stage}`);
  const cleared = new Set<Stage>(STAGE_ORDER.slice(startIdx));
  return replaceEntry(ledger, filename, (e) => {
    const stages: Stages = { ...e.stages };
    for (const s of cleared) stages[s] = null;
    const next: LedgerEntry = {
      ...e,
      stages,
      errors: e.errors.filter((err) => !cleared.has(err.stage)),
    };
    // If prOpened was cleared, prUrl is now meaningless.
    if (cleared.has('prOpened')) delete next.prUrl;
    return next;
  });
}
