// Client-safe (no node:*) tagged rejection reasons + labels (AC-16). The core's quality store
// (`@faerrin/heartwood/src/state/quality.ts`) holds the canonical list for server-side recording;
// this mirror is importable by client components WITHOUT pulling node:crypto/node:fs into the
// browser bundle (the load-bearing server-fn split rule). Keep the two lists in sync.
export const REJECTION_REASONS = [
  "out-of-voice",
  "not-canon",
  "wrong-page",
  "hallucinated",
  "already-known",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  "out-of-voice": "Out of voice",
  "not-canon": "Not canon",
  "wrong-page": "Wrong page",
  hallucinated: "Hallucinated",
  "already-known": "Already known",
};
