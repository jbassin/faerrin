import { createServerFn } from "@tanstack/react-start";
// Static imports are CLIENT-SAFE only: pure path helpers, pure local helpers, types, and
// the pure page-type detector. All node:fs / core-IO is dynamic-imported inside handlers
// (server-only) so it never lands in the client bundle. See paths.ts for the rationale.
import { SESSIONS_DIR, REVIEW_DIR, QUALITY_DIR, TRANSCRIPTS_DIR, within } from "./paths.ts";
import { detectPageType, type PageType } from "../lib/page-type.ts";
import type { SessionArtifact, SessionSummary } from "@faerrin/heartwood/src/state/store.ts";
import type {
  ConflictResolution,
  Decision,
  ReviewState,
  ReviewStatus,
  WeaveTarget,
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
      weave?: WeaveTarget;
    }) => data,
  )
  .handler(async ({ data }): Promise<ReviewState> => {
    const sessionId = assertSessionId(data.arc, data.date);
    const { readReviewState, writeReviewState, applyDecision } = await import(
      "@faerrin/heartwood/src/state/review.ts"
    );
    const current = await readReviewState(REVIEW_DIR, sessionId);
    const prevDecision = current.decisions[data.proposalId]?.decision;
    const next = applyDecision(current, {
      proposalId: data.proposalId,
      decision: data.decision,
      authoredText: data.authoredText,
      rejectionReason: data.rejectionReason,
      targetPath: data.targetPath,
      weave: data.weave,
    });
    await writeReviewState(REVIEW_DIR, next);

    // Rejection memory + quality log (AC-16/AC-26): record the backing claims' signatures on a
    // tagged rejection so later sessions can suppress identical claims; undo them if the reviewer
    // changes a previously-rejected proposal to something else. Only touch the store when the
    // rejected-ness actually changed.
    if (data.decision === "rejected" || prevDecision === "rejected") {
      const { readSessionArtifact } = await import("@faerrin/heartwood/src/state/store.ts");
      const { sessionKey } = await import("@faerrin/heartwood/src/state/identity.ts");
      const { readRejectionStore, writeRejectionStore, recordRejection, removeRejection } =
        await import("@faerrin/heartwood/src/state/quality.ts");
      const artifact = await readSessionArtifact(SESSIONS_DIR, sessionId);
      const proposal = artifact?.proposals.find((p) => p.id === data.proposalId);
      if (proposal) {
        const key = sessionKey(sessionId);
        let store = await readRejectionStore(QUALITY_DIR);
        for (const f of proposal.facts) {
          store =
            data.decision === "rejected"
              ? recordRejection(store, { text: f.text, reason: data.rejectionReason, sessionKey: key })
              : removeRejection(store, f.text, key);
        }
        await writeRejectionStore(QUALITY_DIR, store);
      }
    }
    return next;
  });

export interface PageParagraph {
  /** Full paragraph text — used as the weave anchor (AC-12). */
  text: string;
  /** Short preview for the picker. */
  preview: string;
}

// Non-prose block starts (headings, HTML, quotes, lists, code fences, deity `::` stat lines).
const NON_PROSE = /^(#|<|>|\||[-*]\s|\d+\.\s|```|.+ :: )/;

/** Prose paragraphs of a page, for the weave-location picker (AC-12). */
export const getPageParagraphs = createServerFn({ method: "GET" })
  .inputValidator((data: { path: string }) => data)
  .handler(async ({ data }): Promise<PageParagraph[]> => {
    const { readWikiPage } = await import("./content.ts");
    const body = (await readWikiPage(data.path)).replace(/^---\n[\s\S]*?\n---\n?/, "");
    const out: PageParagraph[] = [];
    for (const block of body.replace(/\n+$/, "").split(/\n{2,}/)) {
      const t = block.trim();
      if (!t || NON_PROSE.test(t)) continue;
      out.push({ text: t, preview: t.length > 80 ? `${t.slice(0, 80)}…` : t });
    }
    return out;
  });

/** Existing wiki folders (for the create-page folder picker, AC-10/D-6). */
export const getWikiFolders = createServerFn({ method: "GET" }).handler(
  async (): Promise<string[]> => {
    const { listWikiMarkdownFiles } = await import("./content.ts");
    const files = await listWikiMarkdownFiles();
    const dirs = new Set<string>([""]); // "" = wiki root
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return [...dirs].sort();
  },
);

export interface InboundSuggestions {
  /** Pages whose body already mentions the entity (candidate inbound links, AC-10). */
  mentions: string[];
  /** True when nothing links/mentions it — a new page nothing points to (flagged, AC-10). */
  orphan: boolean;
}

/** Suggest inbound links for a new page by finding existing pages that mention its name (AC-10). */
export const suggestInboundLinks = createServerFn({ method: "GET" })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<InboundSuggestions> => {
    const { listWikiMarkdownFiles, readWikiPage } = await import("./content.ts");
    const name = data.name.trim();
    if (name.length < 3) return { mentions: [], orphan: true };
    const needle = name.toLowerCase();
    const files = await listWikiMarkdownFiles();
    const mentions: string[] = [];
    for (const f of files) {
      if (f.startsWith("Script/")) continue; // generated transcript pages aren't edit targets
      try {
        if ((await readWikiPage(f)).toLowerCase().includes(needle)) mentions.push(f);
      } catch {
        /* skip unreadable */
      }
      if (mentions.length >= 25) break;
    }
    return { mentions, orphan: mentions.length === 0 };
  });

/** Promote/unpromote a claim from Uncertain/Noise back to Canon (AC-14). */
export const togglePromotion = createServerFn({ method: "POST" })
  .inputValidator((data: { arc: string; date: string; claimId: string }) => data)
  .handler(async ({ data }): Promise<ReviewState> => {
    const sessionId = assertSessionId(data.arc, data.date);
    const { readReviewState, writeReviewState, togglePromotion: toggle } = await import(
      "@faerrin/heartwood/src/state/review.ts"
    );
    const next = toggle(await readReviewState(REVIEW_DIR, sessionId), data.claimId);
    await writeReviewState(REVIEW_DIR, next);
    return next;
  });

const CONFLICT_RESOLUTIONS = ["supersede", "coexist", "reject"] as const;

/** Record a conflict resolution (Supersede / Coexist / Reject) by claimId (AC-11). */
export const saveConflictResolution = createServerFn({ method: "POST" })
  .inputValidator((data: { arc: string; date: string; claimId: string; resolution: ConflictResolution }) => {
    if (!CONFLICT_RESOLUTIONS.includes(data.resolution)) {
      throw new Error(`invalid resolution: ${data.resolution}`);
    }
    return data;
  })
  .handler(async ({ data }): Promise<ReviewState> => {
    const sessionId = assertSessionId(data.arc, data.date);
    const { readReviewState, writeReviewState, applyConflictResolution } = await import(
      "@faerrin/heartwood/src/state/review.ts"
    );
    const current = await readReviewState(REVIEW_DIR, sessionId);
    const next = applyConflictResolution(current, data.claimId, data.resolution);
    await writeReviewState(REVIEW_DIR, next);
    return next;
  });
