// Cross-session rejection memory + quality log (AC-16, AC-26, D-7). When the reviewer
// rejects a proposal with a tagged reason, each backing claim's normalized text is recorded
// here under a stable signature. Two consumers share this one store:
//   - AC-16 quality log — reason tallies, for tuning the mine prompt + the slop-rate metric.
//   - AC-26 rejection memory — a later session auto-suppresses an *identical* previously-
//     rejected claim into a collapsed tray (never silently discarded); `isSuppressed` gates it.
// Persisted as one JSON store (node:fs); signatures are node:crypto sha256 of normalized text
// so cosmetic differences (whitespace, wikilink syntax, emphasis) don't defeat the match.

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { writeFileAtomic } from './atomic';
import { sha256Hex } from '../wiki/hash';
import { normalizeSentence } from '../anchor/anchor';

/** Tagged rejection reasons (spec AC-16). */
export const REJECTION_REASONS = [
  'out-of-voice',
  'not-canon',
  'wrong-page',
  'hallucinated',
  'already-known',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Reasons that indicate a prose/quality miss — counted by the slop-rate metric (AC-17, §12). */
export const VOICE_REJECTION_REASONS: readonly RejectionReason[] = ['out-of-voice', 'hallucinated'];

// One session's rejection of a given claim signature. Keyed by sessionKey so the record is
// idempotent per session and cleanly reversible (un-reject removes exactly this session's mark).
const SessionRejectionSchema = z.object({
  reason: z.string().optional(),
  at: z.string(), // ISO
});

export const RejectionEntrySchema = z.object({
  signature: z.string(),
  /** Normalized example text of the rejected claim — shown in the "previously rejected" tray. */
  text: z.string(),
  /** sessionKey (`arc@date`) → that session's rejection of this signature. */
  bySession: z.record(z.string(), SessionRejectionSchema).default({}),
  firstAt: z.string(),
  lastAt: z.string(),
});
export type RejectionEntry = z.infer<typeof RejectionEntrySchema>;

export const RejectionStoreSchema = z.object({
  entries: z.record(z.string(), RejectionEntrySchema).default({}),
});
export type RejectionStore = z.infer<typeof RejectionStoreSchema>;

export function emptyRejectionStore(): RejectionStore {
  return { entries: {} };
}

/** Stable signature for a claim's text — normalized (anchor rules) then sha256 (node:crypto). */
export function signatureFor(text: string): string {
  return sha256Hex(new TextEncoder().encode(normalizeSentence(text)));
}

/** How many distinct sessions rejected this signature. */
export function rejectionCount(entry: RejectionEntry): number {
  return Object.keys(entry.bySession).length;
}

/** Pure: record (or update) one claim rejection for a session. Idempotent per (signature, session). */
export function recordRejection(
  store: RejectionStore,
  args: { text: string; reason?: string; sessionKey: string; at?: string },
): RejectionStore {
  const signature = signatureFor(args.text);
  const at = args.at ?? new Date().toISOString();
  const prev = store.entries[signature];
  const entry: RejectionEntry = {
    signature,
    text: normalizeSentence(args.text),
    bySession: { ...(prev?.bySession ?? {}), [args.sessionKey]: { reason: args.reason, at } },
    firstAt: prev?.firstAt ?? at,
    lastAt: at,
  };
  return { entries: { ...store.entries, [signature]: entry } };
}

/** Pure: undo a session's rejection of a claim (e.g. the reviewer changed the decision). */
export function removeRejection(
  store: RejectionStore,
  text: string,
  sessionKey: string,
): RejectionStore {
  const signature = signatureFor(text);
  const prev = store.entries[signature];
  if (!prev || !(sessionKey in prev.bySession)) return store;
  const { [sessionKey]: _drop, ...rest } = prev.bySession;
  const entries = { ...store.entries };
  if (Object.keys(rest).length === 0) {
    delete entries[signature];
  } else {
    entries[signature] = { ...prev, bySession: rest };
  }
  return { entries };
}

/**
 * Suppress only an *identical previously-rejected* claim (AC-26/D-7): true when this signature
 * was rejected in some session OTHER than the current one. A claim rejected only in the current
 * session stays in the main list (it already shows its own decision) — we never make the
 * reviewer's just-made choice vanish into the tray.
 */
export function isSuppressed(store: RejectionStore, text: string, currentSessionKey: string): boolean {
  const e = store.entries[signatureFor(text)];
  if (!e) return false;
  return Object.keys(e.bySession).some((k) => k !== currentSessionKey);
}

export function rejectionEntryFor(store: RejectionStore, text: string): RejectionEntry | undefined {
  return store.entries[signatureFor(text)];
}

/** Quality-log reason tally across all rejections (AC-16 tuning signal, dashboard AC-19). */
export function reasonTally(store: RejectionStore): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of Object.values(store.entries)) {
    for (const s of Object.values(e.bySession)) {
      if (s.reason) out[s.reason] = (out[s.reason] ?? 0) + 1;
    }
  }
  return out;
}

export function rejectionStorePath(dir: string): string {
  return join(dir, 'rejections.json');
}

/** Read the cross-session rejection store, or an empty one if none exists yet. */
export async function readRejectionStore(dir: string): Promise<RejectionStore> {
  let text: string;
  try {
    text = await readFile(rejectionStorePath(dir), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyRejectionStore();
    throw err;
  }
  return RejectionStoreSchema.parse(JSON.parse(text));
}

export async function writeRejectionStore(dir: string, store: RejectionStore): Promise<void> {
  const validated = RejectionStoreSchema.parse(store);
  await writeFileAtomic(rejectionStorePath(dir), JSON.stringify(validated, null, 2));
}
