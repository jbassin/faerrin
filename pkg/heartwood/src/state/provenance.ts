// Render-invisible provenance sidecar (spec D-1, AC-15).
//
// For each wiki page we keep a sidecar JSON (mirroring the page's path under a provenance
// root) recording, per approved sentence: which session + transcript lines justify it, the
// backing claim, and the resolved entities — anchored by a durable SentenceAnchor (never a
// marker in the prose). On read we re-anchor against the current wiki body so manual Obsidian
// edits self-heal; sentences that changed beyond recognition are reported stale. Canon is one
// shared world, so every record also carries its originating `arc` (D-9).

import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './atomic';
import { reanchor, type SentenceAnchor } from '../anchor/anchor';

export const SentenceAnchorSchema = z.object({
  headingPath: z.array(z.string()),
  ordinal: z.number().int().nonnegative(),
  normHash: z.string(),
  norm: z.string(),
});

export const CitationSchema = z.object({
  transcript: z.string(), // filename — line ids are per-file, so (transcript,line) is the unit
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ProvenanceRecordSchema = z.object({
  anchor: SentenceAnchorSchema,
  session: z.object({ arc: z.string(), date: z.string() }),
  arc: z.string(), // originating arc, tagged per D-9 (== session.arc)
  citations: z.array(CitationSchema).min(1),
  claimId: z.string(),
  entityIds: z.array(z.string()),
  approvedAt: z.string(), // ISO timestamp
});
export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

export const PageProvenanceSchema = z.object({
  wikiPath: z.string(), // content-relative, e.g. "Geography/Calaria/index.md"
  records: z.array(ProvenanceRecordSchema),
});
export type PageProvenance = z.infer<typeof PageProvenanceSchema>;

/** Sidecar file path for a wiki page under the provenance root. */
export function sidecarPath(provRoot: string, wikiPath: string): string {
  return join(provRoot, `${wikiPath}.prov.json`);
}

/** Read a page's provenance sidecar; returns an empty record set if none exists. */
export async function readPageProvenance(provRoot: string, wikiPath: string): Promise<PageProvenance> {
  const file = Bun.file(sidecarPath(provRoot, wikiPath));
  if (!(await file.exists())) return { wikiPath, records: [] };
  return PageProvenanceSchema.parse(JSON.parse(await file.text()));
}

/** Write a page's provenance sidecar atomically. */
export async function writePageProvenance(provRoot: string, prov: PageProvenance): Promise<void> {
  const validated = PageProvenanceSchema.parse(prov);
  await writeFileAtomic(sidecarPath(provRoot, validated.wikiPath), JSON.stringify(validated, null, 2));
}

export interface ReanchorPageResult {
  /** Records that still resolve (anchors updated in place where the sentence moved/reworded). */
  live: ProvenanceRecord[];
  /** Records whose sentence could not be re-found in the current body. */
  stale: ProvenanceRecord[];
  /** True if any anchor was updated or any record went stale (caller should persist). */
  changed: boolean;
}

/**
 * Re-resolve every record's anchor against the current page `body`. Updates anchors for
 * moved/reworded sentences, partitions out stale records. Pure: returns new arrays.
 */
export function reanchorPage(prov: PageProvenance, body: string): ReanchorPageResult {
  const live: ProvenanceRecord[] = [];
  const stale: ProvenanceRecord[] = [];
  let changed = false;

  for (const rec of prov.records) {
    const r = reanchor(body, rec.anchor);
    if (r.stale) {
      stale.push(rec);
      changed = true;
    } else if (r.updated) {
      live.push({ ...rec, anchor: r.updated });
      changed = true;
    } else {
      live.push(rec);
    }
  }
  return { live, stale, changed };
}

/** Append records to a page's sidecar (used on commit). Does not de-duplicate by anchor. */
export function addRecords(prov: PageProvenance, records: ProvenanceRecord[]): PageProvenance {
  return { wikiPath: prov.wikiPath, records: [...prov.records, ...records] };
}

export function makeRecord(args: {
  anchor: SentenceAnchor;
  arc: string;
  date: string;
  citations: Citation[];
  claimId: string;
  entityIds: string[];
  approvedAt?: string;
}): ProvenanceRecord {
  return {
    anchor: args.anchor,
    session: { arc: args.arc, date: args.date },
    arc: args.arc,
    citations: args.citations,
    claimId: args.claimId,
    entityIds: args.entityIds,
    approvedAt: args.approvedAt ?? new Date().toISOString(),
  };
}
