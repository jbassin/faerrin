// Session identity (spec C8, D-9). A session is one transcript = one recording of one arc.
// Its durable key is (arc, date), NOT the filename stem — the `000` arc reuses one basename
// across ~30 files differing only by date. Arc = the campaign slug (1:1 with the numeric
// prefix). Citations elsewhere are (transcript, lineId); a bare line number is never unique.

// Import the PURE parser (filename.ts), not discover.ts — discover.ts uses Bun.Glob/
// Bun.file, and identity.ts is on the review app's Node server-fn import path.
import { parseFilename } from '../transcript/filename';

export interface SessionId {
  /** Campaign/arc slug, e.g. "through-a-song-darkly" (1:1 with the numeric filename prefix). */
  arc: string;
  /** ISO recording date "YYYY-MM-DD" (NOT in-world date). */
  date: string;
}

/** Stable string key for a session. `@` cannot appear in an arc slug or ISO date. */
export function sessionKey(id: SessionId): string {
  return `${id.arc}@${id.date}`;
}

/** Parse a transcript filename into a SessionId, or null if it doesn't match the convention. */
export function sessionIdFromFilename(filename: string): SessionId | null {
  const parsed = parseFilename(filename);
  if (!parsed) return null;
  return { arc: parsed.campaignName, date: parsed.sessionDate };
}

export function sessionIdEquals(a: SessionId, b: SessionId): boolean {
  return a.arc === b.arc && a.date === b.date;
}
