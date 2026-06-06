import { createServerFn } from "@tanstack/react-start";
// Static imports are CLIENT-SAFE only: pure path helpers, pure local helpers, types, and
// the pure page-type detector. All node:fs / core-IO is dynamic-imported inside handlers
// (server-only) so it never lands in the client bundle. See paths.ts for the rationale.
import { SESSIONS_DIR, REVIEW_DIR, TRANSCRIPTS_DIR, within } from "./paths.ts";
import { detectPageType, type PageType } from "../lib/page-type.ts";
import type { SessionArtifact, SessionSummary } from "@faerrin/heartwood/src/state/store.ts";
import type {
  Decision,
  ReviewState,
  ReviewStatus,
} from "@faerrin/heartwood/src/state/review.ts";

// Arc/date are interpolated into a `${arc}@${date}.json` filename, so validate their
// shape before they touch the filesystem (path-traversal guard, mirrors `within`).
const ARC_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function assertSessionId(arc: string, date: string): { arc: string; date: string } {
  if (!ARC_RE.test(arc)) throw new Error(`invalid arc: ${arc}`);
  if (!DATE_RE.test(date)) throw new Error(`invalid date: ${date}`);
  return { arc, date };
}

export interface SessionListItem extends SessionSummary {
  status: ReviewStatus;
}

/** Session list with review status (Unreviewed / Partial / Reviewed) — AC-23 entry. */
export const listSessions = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionListItem[]> => {
    const { listSessionArtifacts } = await import("@faerrin/heartwood/src/state/store.ts");
    const { readReviewState, reviewStatus } = await import("@faerrin/heartwood/src/state/review.ts");
    const summaries = await listSessionArtifacts(SESSIONS_DIR);
    const out: SessionListItem[] = [];
    for (const s of summaries) {
      const review = await readReviewState(REVIEW_DIR, s.sessionId);
      out.push({ ...s, status: reviewStatus(review, s.proposalIds) });
    }
    return out;
  },
);

export interface SessionView {
  artifact: SessionArtifact;
  review: ReviewState;
  /** Target page type per proposal id — drives the page-type-aware voice bar (AC-24). */
  pageTypes: Record<string, PageType>;
  /** Every known page slug — for wikilink validation in authored prose (AC-13). */
  allSlugs: string[];
}

/** Full session payload for review: proposals + narrative + triage + conflicts + decisions. */
export const getSession = createServerFn({ method: "GET" })
  .inputValidator((data: { arc: string; date: string }) => data)
  .handler(async ({ data }): Promise<SessionView> => {
    const sessionId = assertSessionId(data.arc, data.date);
    const { readSessionArtifact } = await import("@faerrin/heartwood/src/state/store.ts");
    const { readReviewState } = await import("@faerrin/heartwood/src/state/review.ts");
    const { loadAllSlugs, readWikiPage } = await import("./content.ts");

    const artifact = await readSessionArtifact(SESSIONS_DIR, sessionId);
    if (!artifact) throw new Error(`Session ${data.arc}@${data.date} not ingested`);
    const review = await readReviewState(REVIEW_DIR, sessionId);

    const allSlugs = await loadAllSlugs();
    const pageTypes: Record<string, PageType> = {};
    for (const p of artifact.proposals) {
      if (p.kind === "amend" && p.targetPath) {
        try {
          pageTypes[p.id] = detectPageType(p.targetPath, await readWikiPage(p.targetPath));
        } catch {
          pageTypes[p.id] = "lore"; // missing page → treat as prose
        }
      } else {
        pageTypes[p.id] = "lore"; // new page authored as prose
      }
    }
    return { artifact, review, pageTypes, allSlugs };
  });

export interface TranscriptLine {
  id: number;
  speaker: string;
  text: string;
}

// Transcript lines are `NNNNNN<TAB>Speaker: text`; ids are zero-padded 6-digit per-file
// (C8), but accept 6+ digits so an over-long id is never silently dropped from a citation.
const LINE_RE = /^(\d{6,})\t([^:]+):\s?(.*)$/;

/** Pure: extract transcript lines whose id falls in [start, end]. Testable. */
export function parseTranscriptRange(
  raw: string,
  start: number,
  end: number,
): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const id = Number(m[1]);
    if (id < start || id > end) continue;
    out.push({ id, speaker: m[2]!.trim(), text: m[3]! });
  }
  return out;
}

/** Local transcript line lookup for citation-on-hover (AC-3) — no LLM, instant. */
export const getTranscriptLines = createServerFn({ method: "GET" })
  .inputValidator((data: { transcript: string; start: number; end: number }) => data)
  .handler(async ({ data }): Promise<TranscriptLine[]> => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(within(TRANSCRIPTS_DIR, data.transcript), "utf8");
    return parseTranscriptRange(raw, data.start, data.end);
  });

/** Persist one proposal decision; returns the updated review state (AC-6/AC-8). */
export const saveDecision = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      arc: string;
      date: string;
      proposalId: string;
      decision: Decision;
      authoredText?: string;
      rejectionReason?: string;
      targetPath?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<ReviewState> => {
    const sessionId = assertSessionId(data.arc, data.date);
    const { readReviewState, writeReviewState, applyDecision } = await import(
      "@faerrin/heartwood/src/state/review.ts"
    );
    const current = await readReviewState(REVIEW_DIR, sessionId);
    const next = applyDecision(current, {
      proposalId: data.proposalId,
      decision: data.decision,
      authoredText: data.authoredText,
      rejectionReason: data.rejectionReason,
      targetPath: data.targetPath,
    });
    await writeReviewState(REVIEW_DIR, next);
    return next;
  });
