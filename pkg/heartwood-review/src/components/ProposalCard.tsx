import { useState } from "react";
import { renderMarkdown } from "@/server/render";
import { saveDecision, type SessionView } from "@/server/sessions";
import { draftProposal } from "@/server/draft";
import type {
  Decision,
  ReviewState,
} from "@faerrin/heartwood/src/state/review.ts";
import { CitationChip } from "./CitationChip.tsx";
import { CreatePagePicker } from "./CreatePagePicker.tsx";
import { voiceWarnings } from "@/lib/voice-warnings.ts";
import type { PageType } from "@/lib/page-type.ts";
import {
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type RejectionReason,
} from "@/lib/rejection-reasons.ts";
import "@/styles/wiki-render.css";

type Proposal = SessionView["artifact"]["proposals"][number];
type Fact = Proposal["facts"][number];

interface Props {
  arc: string;
  date: string;
  proposal: Proposal;
  initialDecision: Decision;
  initialText: string;
  initialTargetPath: string;
  /** Existing page body (frontmatter-stripped) for an amend — populates the editor. */
  initialPageBody: string;
  initialReason: string;
  /** A backing fact carries an Accepted conflict — this page changes existing canon (AC-11). */
  acceptedConflict?: boolean;
  pageType: PageType;
  allSlugs: string[];
  onSaved: (state: ReviewState) => void;
}

const DECISION_COLORS: Record<Decision, string> = {
  pending: "#5f6368",
  approved: "#137333",
  rejected: "#c5221f",
  deferred: "#b06000",
};

export function ProposalCard({
  arc,
  date,
  proposal,
  initialDecision,
  initialText,
  initialTargetPath,
  initialPageBody,
  initialReason,
  acceptedConflict,
  pageType,
  allSlugs,
  onSaved,
}: Props) {
  // For an amend the editor is populated with the existing page body (the reviewer edits it in
  // place); a saved decision's text wins on resume. For a create it starts empty.
  const [authored, setAuthored] = useState(initialText || initialPageBody);
  const [targetPath, setTargetPath] = useState(initialTargetPath);
  const [decision, setDecision] = useState<Decision>(initialDecision);
  const [reason, setReason] = useState<string>(initialReason);
  const [picking, setPicking] = useState(false);
  const [view, setView] = useState<"edit" | "reading" | "diff">("edit");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isDraft, setIsDraft] = useState(false);

  const warnings = voiceWarnings(authored, { pageType, allSlugs });
  // A new page targets its (proposed) path; amend targets the existing page.
  const srcPath = proposal.targetPath ?? `${proposal.canonicalName}.md`;

  async function refreshPreview() {
    // The editor holds the full page body (amend = the existing page you edited; create = the new
    // page), so Reading just renders that text as it will appear on the wiki.
    setPreviewHtml(
      await renderMarkdown({
        data: { md: authored || "*(no prose yet)*", srcPath },
      }),
    );
  }

  async function showReading() {
    await refreshPreview();
    setView("reading");
  }

  // D-5: fetch an in-voice draft as an editable starting point. Never auto-approves.
  async function doDraft() {
    setDrafting(true);
    setDraftError(null);
    try {
      const { draft } = await draftProposal({
        data: { arc, date, proposalId: proposal.id },
      });
      // Don't clobber the populated page — append the draft so the reviewer can position it.
      setAuthored((prev) => appendBlock(prev, draft));
      setIsDraft(true);
      setView("edit");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  async function decide(d: Decision, rejectionReason?: string) {
    setBusy(true);
    try {
      const state = await saveDecision({
        data: {
          arc,
          date,
          proposalId: proposal.id,
          decision: d,
          authoredText: authored || undefined,
          rejectionReason: d === "rejected" ? rejectionReason : undefined,
          targetPath:
            proposal.kind === "create" ? targetPath || undefined : undefined,
        },
      });
      setDecision(d);
      setReason(d === "rejected" ? (rejectionReason ?? "") : "");
      setPicking(false);
      onSaved(state);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      style={{
        border: "1px solid #e2e2e5",
        borderRadius: 10,
        padding: "1rem 1.15rem",
        marginBottom: "1rem",
        borderLeft: `4px solid ${DECISION_COLORS[decision]}`,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <strong style={{ fontSize: "1.1rem" }}>{proposal.canonicalName}</strong>
        <span
          style={{
            fontSize: "0.78rem",
            color: DECISION_COLORS[decision],
            fontWeight: 600,
          }}
        >
          {proposal.kind === "amend"
            ? `amend → ${proposal.targetPath}`
            : "create new page"}{" "}
          · {decision}
        </span>
      </header>

      {/* AC-11: an accepted conflict means this page revises existing canon. */}
      {acceptedConflict && (
        <div
          style={{
            marginTop: "0.4rem",
            fontSize: "0.78rem",
            color: "#b06000",
            fontWeight: 600,
          }}
        >
          ⚠ accepted conflict — this changes existing canon; edit the page to
          reconcile the contradiction.
        </div>
      )}

      {/* Source facts with per-citation hover (AC-3). */}
      <ul style={{ margin: "0.6rem 0", paddingLeft: "1.1rem" }}>
        {proposal.facts.map((f: Fact) => (
          <li key={f.claimId} style={{ marginBottom: "0.3rem" }}>
            {f.text}{" "}
            {f.citations.map((c, i) => (
              <CitationChip key={i} citation={c} />
            ))}
            {f.modality !== "gm-stated" && (
              <em style={{ color: "#b06000", fontSize: "0.78rem" }}>
                {" "}
                [{f.modality}]
              </em>
            )}
          </li>
        ))}
      </ul>

      {/* View toggle (AC-2): edit · reading (rendered in context) · diff. */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          margin: "0.5rem 0",
          fontSize: "0.8rem",
        }}
      >
        <ViewTab
          label="Edit"
          active={view === "edit"}
          onClick={() => setView("edit")}
        />
        <ViewTab
          label="Reading"
          active={view === "reading"}
          onClick={() => void showReading()}
        />
        <ViewTab
          label="Diff"
          active={view === "diff"}
          onClick={() => {
            void refreshPreview();
            setView("diff");
          }}
        />
        <button
          type="button"
          disabled={drafting}
          onClick={() => void doDraft()}
          title="Generate an in-voice draft as an editable starting point (never auto-committed)"
          style={{
            marginLeft: "auto",
            ...linkBtn,
            opacity: drafting ? 0.5 : 1,
          }}
        >
          {drafting ? "drafting…" : "✨ draft in voice"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAuthored((prev) =>
              appendBlock(prev, proposal.facts.map((f) => f.text).join(" ")),
            );
            setIsDraft(false);
          }}
          style={linkBtn}
        >
          append facts
        </button>
      </div>
      {draftError && (
        <div
          style={{
            color: "#c5221f",
            fontSize: "0.78rem",
            marginBottom: "0.4rem",
          }}
        >
          Draft failed: {draftError} (needs ANTHROPIC_API_KEY in the app
          environment)
        </div>
      )}

      {view === "edit" && (
        <>
          {proposal.kind === "create" && (
            <CreatePagePicker
              canonicalName={proposal.canonicalName}
              initialTargetPath={initialTargetPath}
              onChange={setTargetPath}
            />
          )}
          {proposal.kind === "amend" && proposal.targetPath && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#5f6368",
                marginBottom: "0.4rem",
              }}
            >
              Editing the full page <code>{proposal.targetPath}</code> — the
              existing text is loaded below. Add the new information where it
              belongs; on commit your version replaces the page body
              (frontmatter is preserved).
            </div>
          )}
          {isDraft && (
            <div
              style={{
                fontSize: "0.75rem",
                color: "#7b1fa2",
                marginBottom: "0.25rem",
              }}
            >
              ✨ machine draft — edit it into your voice before approving; it is
              never committed as-is. The warnings below are the voice critic.
            </div>
          )}
          <textarea
            value={authored}
            onChange={(e) => {
              setAuthored(e.target.value);
              setIsDraft(false);
            }}
            placeholder={
              proposal.kind === "amend"
                ? "The existing page text loads here — edit it to weave in the cited facts above…"
                : "Write the wiki prose in your voice, drawing on the cited facts above…"
            }
            rows={proposal.kind === "amend" ? 16 : 6}
            style={{
              width: "100%",
              font: "inherit",
              fontSize: "0.95rem",
              padding: "0.6rem",
              borderRadius: 6,
              border: isDraft ? "1px solid #7b1fa2" : "1px solid #ccc",
              resize: "vertical",
            }}
          />
          {/* Voice warnings (AC-9) — never blocking. */}
          {warnings.length > 0 && (
            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
              {warnings.map((w, i) => (
                <li
                  key={i}
                  style={{
                    color: w.type === "empty" ? "#999" : "#b06000",
                    fontSize: "0.8rem",
                  }}
                >
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === "reading" && (
        <div>
          <div
            style={{
              fontSize: "0.72rem",
              color: "#137333",
              fontWeight: 600,
              marginBottom: "0.3rem",
            }}
          >
            {proposal.kind === "amend"
              ? "the edited page as it will render — judge the whole thing"
              : "new page as it will render"}
          </div>
          {/* Rendered in aether-faithful context (AC-2). */}
          <div
            className="wiki-article"
            dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
          />
        </div>
      )}

      {view === "diff" && (
        <pre
          style={{
            background: "#0a3a1a0d",
            padding: "0.6rem",
            borderRadius: 6,
            whiteSpace: "pre-wrap",
            fontSize: "0.85rem",
          }}
        >
          {diffLines(
            proposal.kind === "amend" ? initialPageBody : "",
            authored,
          )}
        </pre>
      )}

      {/* Decisions (AC-6: persisted, but nothing written to the wiki until commit). */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <DecideBtn
          label="Approve"
          tone="#137333"
          disabled={
            busy ||
            !authored.trim() ||
            (proposal.kind === "create" && !targetPath.trim())
          }
          onClick={() => decide("approved")}
        />
        <DecideBtn
          label="Reject"
          tone="#c5221f"
          disabled={busy}
          onClick={() => setPicking((p) => !p)}
        />
        <DecideBtn
          label="Defer"
          tone="#b06000"
          disabled={busy}
          onClick={() => decide("deferred")}
        />
        {decision === "rejected" && reason && (
          <span
            style={{
              alignSelf: "center",
              fontSize: "0.78rem",
              color: "#c5221f",
            }}
          >
            rejected:{" "}
            {REJECTION_REASON_LABELS[reason as RejectionReason] ?? reason}
          </span>
        )}
      </div>

      {/* AC-16: a tagged reason on Reject → quality log + rejection memory. */}
      {picking && (
        <div
          style={{
            marginTop: "0.6rem",
            padding: "0.6rem 0.75rem",
            background: "rgba(197,34,31,0.06)",
            border: "1px solid rgba(197,34,31,0.25)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              fontSize: "0.78rem",
              color: "#c5221f",
              fontWeight: 600,
              marginBottom: "0.4rem",
            }}
          >
            Why reject? (tags the quality log; an identical claim is suppressed
            next session)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {REJECTION_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={busy}
                onClick={() => decide("rejected", r)}
                style={{
                  font: "inherit",
                  fontSize: "0.8rem",
                  padding: "0.25rem 0.7rem",
                  borderRadius: 999,
                  border: "1px solid #c5221f",
                  background: "#fff",
                  color: "#c5221f",
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                {REJECTION_REASON_LABELS[r]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => decide("rejected")}
              disabled={busy}
              style={{ ...linkBtn }}
            >
              reject without a reason
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

const linkBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.8rem",
  color: "#2b6cb0",
  background: "none",
  border: "none",
  cursor: "pointer",
  textDecoration: "underline",
};

/** Append a block of text to existing editor content, separated by a blank line (no-op join if empty). */
function appendBlock(prev: string, add: string): string {
  const a = add.trim();
  if (!a) return prev;
  const base = prev.replace(/\s+$/, "");
  return base ? `${base}\n\n${a}` : a;
}

/** A lightweight line diff: lines in `current` absent from `original` are `+`, removed lines `-`. */
function diffLines(original: string, current: string): string {
  const origSet = new Set(original.split("\n"));
  const curSet = new Set(current.split("\n"));
  const out = current
    .split("\n")
    .map((l) => (origSet.has(l) ? `  ${l}` : `+ ${l}`));
  for (const l of original.split("\n"))
    if (l.trim() && !curSet.has(l)) out.push(`- ${l}`);
  return out.join("\n");
}

function ViewTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        font: "inherit",
        fontSize: "0.8rem",
        padding: "0.15rem 0.6rem",
        borderRadius: 999,
        border: "1px solid",
        borderColor: active ? "#2b6cb0" : "#d0d0d5",
        background: active ? "rgba(43,108,176,0.1)" : "transparent",
        color: active ? "#2b6cb0" : "#555",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DecideBtn({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        font: "inherit",
        fontWeight: 600,
        fontSize: "0.85rem",
        padding: "0.35rem 0.9rem",
        borderRadius: 6,
        border: `1px solid ${tone}`,
        background: disabled ? "#f1f1f3" : tone,
        color: disabled ? "#aaa" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
