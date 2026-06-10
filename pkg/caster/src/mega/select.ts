// Member selection + synthetic id for a "mega" episode: one month-in-review recap
// fused from several sessions in a date range. Pure + fully testable — no I/O.

import type { Session, SessionDigest } from "../types.ts";
import { dateSortKey } from "../ingest/transcript.ts";

/** A member session paired with its already-distilled digest. */
export interface MegaMember {
  session: Session;
  digest: SessionDigest;
}

export interface SelectOptions {
  /** Inclusive range start, "YYYY-M-D" (unpadded, as in transcript filenames). */
  from: string;
  /** Inclusive range end, "YYYY-M-D". */
  to: string;
  /**
   * Restrict to a single arc slug. When omitted, every in-range session must
   * already share one arc (a cross-arc mega is ambiguous and errors).
   */
  arc?: string;
}

/** Inclusive date-range test on the "YYYY-M-D" form, via the numeric sort key. */
export function dateInRange(date: string, from: string, to: string): boolean {
  const k = dateSortKey(date);
  return k >= dateSortKey(from) && k <= dateSortKey(to);
}

/**
 * Pick the sessions a mega episode should cover: those in [from, to] (inclusive),
 * optionally narrowed to one arc. Returns them in chronological order. Throws on
 * an empty range, no matches, or — without an explicit `arc` — a span that
 * crosses multiple arcs (which session would name the recap is then ambiguous).
 */
export function selectMembers(sessions: Session[], opts: SelectOptions): Session[] {
  const { from, to, arc } = opts;
  if (dateSortKey(from) > dateSortKey(to)) {
    throw new Error(`Empty range: from (${from}) is after to (${to}).`);
  }

  let members = sessions.filter((s) => dateInRange(s.date, from, to));
  if (arc) members = members.filter((s) => s.arc === arc);

  if (members.length === 0) {
    throw new Error(`No sessions in ${from}..${to}${arc ? ` for arc "${arc}"` : ""}.`);
  }

  const arcs = new Set(members.map((s) => s.arc));
  if (arcs.size > 1) {
    throw new Error(
      `Sessions in ${from}..${to} span multiple arcs (${[...arcs].join(", ")}). ` +
        `Pass --arc=<slug> to pick one.`,
    );
  }

  return [...members].sort((a, b) => dateSortKey(a.date) - dateSortKey(b.date));
}

/**
 * Synthetic session id for the fused episode, derived from the span it actually
 * covers: `<arcNumber>.<arcSlug>.<lastDate>-recap-of-<firstDate>`, e.g.
 * `000.through-a-song-darkly.2026-6-8-recap-of-2026-5-7`.
 *
 * Shape chosen so the consuming site (face) treats it like any other episode with
 * NO code changes:
 *  - the real arc slug is preserved, so face resolves the pretty arc title;
 *  - the date token's first three hyphen groups stay numeric, so face's `dateKey`
 *    sort parses it — and we lead with the LAST covered date so the recap sorts to
 *    the END of its arc (a capstone after the sessions it summarizes, not among
 *    them). The `-recap-of-<first>` tail keeps the full span in the id and reads as
 *    "<end> recap of <start>".
 * It's also filesystem- and URL-safe (one dot per segment).
 */
export function megaId(members: Session[]): string {
  if (members.length === 0) throw new Error("megaId needs at least one member session.");
  const sorted = [...members].sort((a, b) => dateSortKey(a.date) - dateSortKey(b.date));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const arcNumber = first.id.split(".")[0]!;
  return `${arcNumber}.${first.arc}.${last.date}-recap-of-${first.date}`;
}
