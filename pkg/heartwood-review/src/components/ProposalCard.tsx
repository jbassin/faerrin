import { useState } from "react";
import { renderMarkdown, renderPagePreview } from "@/server/render";
import { saveDecision, type SessionView } from "@/server/sessions";
import type { Decision, ReviewState } from "@faerrin/heartwood/src/state/review.ts";
import { CitationChip } from "./CitationChip.tsx";
import { voiceWarnings } from "@/lib/voice-warnings.ts";
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
  onSaved: (state: ReviewState) => void;
}

const DECISION_COLORS: Record<Decision, string> = {
  pending: "#5f6368",
  approved: "#137333",
  rejected: "#c5221f",
  deferred: "#b06000",
};

export function ProposalCard({ arc, date, proposal, initialDecision, initialText, initialTargetPath, onSaved }: Props) {
  const [authored, setAuthored] = useState(initialText);
  const [targetPath, setTargetPath] = useState(initialTargetPath);
  const [decision, setDecision] = useState<Decision>(initialDecision);
  const [view, setView] = useState<"edit" | "reading" | "diff">("edit");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [existingHtml, setExistingHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const warnings = voiceWarnings(authored);
  // A new page targets its (proposed) path; amend targets the existing page.
  const srcPath = proposal.targetPath ?? `${proposal.canonicalName}.md`;

  async function refreshPreview() {
    const html = await renderMarkdown({ data: { md: authored || "*(no prose yet)*", srcPath } });
    setPreviewHtml(html);
    if (proposal.kind === "amend" && proposal.targetPath && existingHtml === null) {
      const page = await renderPagePreview({ data: { path: proposal.targetPath } });
      setExistingHtml(page.html);
    }
  }

  async function showReading() {
    await refreshPreview();
    setView("reading");
  }

  async function decide(d: Decision) {
    setBusy(true);
    try {
      const state = await saveDecision({
        data: {
          arc,
          date,
          proposalId: proposal.id,
          decision: d,
          authoredText: authored || undefined,
          targetPath: proposal.kind === "create" ? targetPath || undefined : undefined,
        },
      });
      setDecision(d);
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
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: "1.1rem" }}>{proposal.canonicalName}</strong>
        <span style={{ fontSize: "0.78rem", color: DECISION_COLORS[decision], fontWeight: 600 }}>
          {proposal.kind === "amend" ? `amend → ${proposal.targetPath}` : "create new page"} · {decision}
        </span>
      </header>

      {/* Source facts with per-citation hover (AC-3). */}
      <ul style={{ margin: "0.6rem 0", paddingLeft: "1.1rem" }}>
        {proposal.facts.map((f: Fact) => (
          <li key={f.claimId} style={{ marginBottom: "0.3rem" }}>
            {f.text}{" "}
            {f.citations.map((c, i) => (
              <CitationChip key={i} citation={c} />
            ))}
            {f.modality !== "gm-stated" && (
              <em style={{ color: "#b06000", fontSize: "0.78rem" }}> [{f.modality}]</em>
            )}
          </li>
        ))}
      </ul>

      {/* View toggle (AC-2): edit · reading (rendered in context) · diff. */}
      <div style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0", fontSize: "0.8rem" }}>
        <ViewTab label="Edit" active={view === "edit"} onClick={() => setView("edit")} />
        <ViewTab label="Reading" active={view === "reading"} onClick={() => void showReading()} />
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
          onClick={() => setAuthored(proposal.facts.map((f) => f.text).join(" "))}
          style={{ marginLeft: "auto", ...linkBtn }}
        >
          scaffold from facts
        </button>
      </div>

      {view === "edit" && (
        <>
          {proposal.kind === "create" && (
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "#555" }}>
              New page path (content-relative, under wiki/):
              <input
                type="text"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder={`e.g. People/${proposal.canonicalName}.md`}
                style={{
                  width: "100%",
                  font: "inherit",
                  fontSize: "0.9rem",
                  padding: "0.4rem",
                  marginTop: "0.25rem",
                  borderRadius: 6,
                  border: "1px solid #ccc",
                }}
              />
            </label>
          )}
          <textarea
            value={authored}
            onChange={(e) => setAuthored(e.target.value)}
            placeholder="Write the wiki prose in your voice, drawing on the cited facts above…"
            rows={5}
            style={{
              width: "100%",
              font: "inherit",
              fontSize: "0.95rem",
              padding: "0.6rem",
              borderRadius: 6,
              border: "1px solid #ccc",
              resize: "vertical",
            }}
          />
          {/* Voice warnings (AC-9) — never blocking. */}
          {warnings.length > 0 && (
            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
              {warnings.map((w, i) => (
                <li key={i} style={{ color: w.type === "empty" ? "#999" : "#b06000", fontSize: "0.8rem" }}>
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === "reading" && (
        <div>
          {existingHtml && (
            <div className="wiki-article" dangerouslySetInnerHTML={{ __html: existingHtml }} />
          )}
          <div
            style={{
              marginTop: "0.6rem",
              padding: "0.5rem 0.75rem",
              background: "rgba(19,115,51,0.08)",
              borderLeft: "3px solid #137333",
              borderRadius: 4,
            }}
          >
            <div style={{ fontSize: "0.72rem", color: "#137333", fontWeight: 600 }}>
              proposed {proposal.kind === "amend" ? "addition" : "page"}
            </div>
            <div
              className="wiki-article"
              dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
            />
          </div>
        </div>
      )}

      {view === "diff" && (
        <pre style={{ background: "#0a3a1a0d", padding: "0.6rem", borderRadius: 6, whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>
          {authored
            .split("\n")
            .map((l) => `+ ${l}`)
            .join("\n")}
        </pre>
      )}

      {/* Decisions (AC-6: persisted, but nothing written to the wiki until commit). */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <DecideBtn
          label="Approve"
          tone="#137333"
          disabled={busy || !authored.trim() || (proposal.kind === "create" && !targetPath.trim())}
          onClick={() => decide("approved")}
        />
        <DecideBtn label="Reject" tone="#c5221f" disabled={busy} onClick={() => decide("rejected")} />
        <DecideBtn label="Defer" tone="#b06000" disabled={busy} onClick={() => decide("deferred")} />
      </div>
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

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function DecideBtn({ label, tone, disabled, onClick }: { label: string; tone: string; disabled?: boolean; onClick: () => void }) {
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
