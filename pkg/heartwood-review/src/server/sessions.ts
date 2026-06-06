import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
// Deep-imports into the core (NOT the package root — that runs the CLI on import).
// These modules are Node-safe (node:fs, no Bun globals at module load).
import {
  listSessionArtifacts,
  readSessionArtifact,
  type SessionArtifact,
  type SessionSummary,
} from "@faerrin/heartwood/src/state/store.ts";
import {
  applyDecision,
  readReviewState,
  reviewStatus,
  writeReviewState,
  type Decision,
  type ReviewState,
  type ReviewStatus,
} from "@faerrin/heartwood/src/state/review.ts";
import { TRANSCRIPTS_DIR } from "./content.ts";

// The pipeline persists artifacts under the core package's state dir; the dev
// server cwd is pkg/heartwood-review, so the core is `../heartwood`.
const CORE_STATE = join(process.cwd(), "..", "heartwood", "state");
const SESSIONS_DIR = join(CORE_STATE, "sessions");
const REVIEW_DIR = join(CORE_STATE, "review");

export interface SessionListItem extends SessionSummary {
  status: ReviewStatus;
}

/** Session list with review status (Unreviewed / Partial / Reviewed) — AC-23 entry. */
export const listSessions = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionListItem[]> => {
    const summaries = await listSessionArtifacts(SESSIONS_DIR);
    const out: SessionListItem[] = [];
    for (const s of summaries) {
      const artifact = await readSessionArtifact(SESSIONS_DIR, s.sessionId);
      const review = await readReviewState(REVIEW_DIR, s.sessionId);
      const ids = artifact ? artifact.proposals.map((p) => p.id) : [];
      out.push({ ...s, status: reviewStatus(review, ids) });
    }
    return out;
  },
);

export interface SessionView {
  artifact: SessionArtifact;
  review: ReviewState;
}

/** Full session payload for review: proposals + narrative + triage + conflicts + decisions. */
export const getSession = createServerFn({ method: "GET" })
  .inputValidator((data: { arc: string; date: string }) => data)
  .handler(async ({ data }): Promise<SessionView> => {
    const sessionId = { arc: data.arc, date: data.date };
    const artifact = await readSessionArtifact(SESSIONS_DIR, sessionId);
    if (!artifact) throw new Error(`Session ${data.arc}@${data.date} not ingested`);
    const review = await readReviewState(REVIEW_DIR, sessionId);
    return { artifact, review };
  });

export interface TranscriptLine {
  id: number;
  speaker: string;
  text: string;
}

// Transcript lines are `NNNNNN<TAB>Speaker: text`; ids are per-file (C8).
const LINE_RE = /^(\d{6})\t([^:]+):\s?(.*)$/;

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
    const raw = await readFile(join(TRANSCRIPTS_DIR, data.transcript), "utf8");
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
    }) => data,
  )
  .handler(async ({ data }): Promise<ReviewState> => {
    const sessionId = { arc: data.arc, date: data.date };
    const current = await readReviewState(REVIEW_DIR, sessionId);
    const next = applyDecision(current, {
      proposalId: data.proposalId,
      decision: data.decision,
      authoredText: data.authoredText,
      rejectionReason: data.rejectionReason,
    });
    await writeReviewState(REVIEW_DIR, next);
    return next;
  });
