import { createServerFn } from "@tanstack/react-start";
// CLIENT-SAFE shell (load-bearing rule): static imports are only createServerFn + path
// constants (node:path, client-safe) + types. All node:fs and core modules are
// dynamic-imported inside the handler so none of it reaches the client bundle.
import { EVAL_RESULTS_DIR, SESSIONS_DIR, REVIEW_DIR, QUALITY_DIR } from "./paths.ts";
import type { SlopInput, SlopResult } from "@faerrin/heartwood/src/eval/slop.ts";

/** One labeled eval session's headline numbers (AC-19), produced by `heartwood eval --save`. */
export interface CoverageRow {
  arc: string;
  date: string;
  labeledFacts: number;
  producedClaims: number;
  coverage: number;
  precision: number;
  falseCanonRate: number;
  generatedAt: string;
}

/** Per-session reviewer-decision slop (the non-circular metric). */
export interface SlopRow {
  arc: string;
  date: string;
  decided: number;
  slop: number;
  slopRate: number;
}

export interface DashboardData {
  /** Coverage/precision/false-canon per labeled eval session (empty until `eval --save` is run). */
  coverage: CoverageRow[];
  /** Slop from reviewer decisions: aggregate across all reviewed sessions + per session. */
  slop: { aggregate: SlopResult; perSession: SlopRow[] };
  /** Rejection-reason tally across all sessions (AC-16 tuning signal). */
  reasonTally: Record<string, number>;
  /** Sessions with at least one terminal decision. */
  reviewedSessions: number;
  totalSessions: number;
}

/** Coverage/slop dashboard data (AC-19): eval harness numbers + live reviewer-decision slop. */
export const getDashboard = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardData> => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { listSessionArtifacts, readSessionArtifact } = await import(
    "@faerrin/heartwood/src/state/store.ts"
  );
  const { readReviewState } = await import("@faerrin/heartwood/src/state/review.ts");
  const { readRejectionStore, reasonTally } = await import("@faerrin/heartwood/src/state/quality.ts");
  const { slopRate } = await import("@faerrin/heartwood/src/eval/slop.ts");

  // --- Coverage rows from eval/results/*.score.json (best-effort; absent until eval --save). ---
  const coverage: CoverageRow[] = [];
  try {
    const names = await readdir(EVAL_RESULTS_DIR);
    for (const name of names) {
      if (!name.endsWith(".score.json")) continue;
      try {
        const row = JSON.parse(await readFile(join(EVAL_RESULTS_DIR, name), "utf8")) as CoverageRow;
        coverage.push(row);
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* no eval results dir yet */
  }
  coverage.sort((a, b) => b.date.localeCompare(a.date) || a.arc.localeCompare(b.arc));

  // --- Live slop from reviewer decisions across every ingested session (non-circular). ---
  const summaries = await listSessionArtifacts(SESSIONS_DIR);
  const allInputs: SlopInput[] = [];
  const perSession: SlopRow[] = [];
  let reviewedSessions = 0;
  for (const s of summaries) {
    const artifact = await readSessionArtifact(SESSIONS_DIR, s.sessionId);
    if (!artifact) continue;
    const review = await readReviewState(REVIEW_DIR, s.sessionId);
    const inputs = artifact.proposals.map((p) => {
      const d = review.decisions[p.id];
      return {
        decision: d?.decision ?? ("pending" as const),
        rejectionReason: d?.rejectionReason,
        authoredText: d?.authoredText,
      };
    });
    const r = slopRate(inputs);
    if (r.decided > 0) {
      reviewedSessions++;
      perSession.push({
        arc: s.sessionId.arc,
        date: s.sessionId.date,
        decided: r.decided,
        slop: r.slop,
        slopRate: r.slopRate,
      });
    }
    allInputs.push(...inputs);
  }
  perSession.sort((a, b) => b.date.localeCompare(a.date) || a.arc.localeCompare(b.arc));

  const store = await readRejectionStore(QUALITY_DIR);

  return {
    coverage,
    slop: { aggregate: slopRate(allInputs), perSession },
    reasonTally: reasonTally(store),
    reviewedSessions,
    totalSessions: summaries.length,
  };
});
