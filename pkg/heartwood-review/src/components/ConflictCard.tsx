import { useState } from "react";
import { saveConflictResolution, type SessionView } from "@/server/sessions";
import type {
  ConflictResolution,
  ReviewState,
} from "@faerrin/heartwood/src/state/review.ts";

type Conflict = SessionView["artifact"]["conflicts"][number];

// AC-11: surface a flagged canon conflict with both statements + source, and offer Accept /
// Reject (never auto-resolved). The choice is persisted by the conflicting claimId:
// - Accept → keep the new fact in its page's proposal (the page becomes a correction); the
//   conflict collapses into the resolved tray and you reconcile it in the full-page editor.
// - Reject → drop the new fact from its proposal entirely (the page keeps the old canon).
const OPTIONS: {
  value: ConflictResolution;
  label: string;
  hint: string;
  tone: string;
}[] = [
  {
    value: "accepted",
    label: "Accept",
    hint: "the new fact is right — keep it in this page's proposal (changing existing canon)",
    tone: "#137333",
  },
  {
    value: "rejected",
    label: "Reject",
    hint: "drop the new fact from the proposal; the page keeps what it already says",
    tone: "#c5221f",
  },
];

export function ConflictCard({
  arc,
  date,
  conflict,
  initial,
  onResolved,
}: {
  arc: string;
  date: string;
  conflict: Conflict;
  initial: ConflictResolution | undefined;
  onResolved: (state: ReviewState) => void;
}) {
  const [choice, setChoice] = useState<ConflictResolution | undefined>(initial);
  const [busy, setBusy] = useState(false);

  async function choose(resolution: ConflictResolution) {
    setBusy(true);
    try {
      const state = await saveConflictResolution({
        data: { arc, date, claimId: conflict.claimId, resolution },
      });
      setChoice(resolution);
      onResolved(state);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "0.6rem",
        paddingTop: "0.6rem",
        borderTop: "1px solid rgba(176,96,0,0.25)",
      }}
    >
      <strong>{conflict.canonicalName}</strong>{" "}
      <span style={{ color: "#777", fontSize: "0.8rem" }}>
        (existing: <code>{conflict.sourceRef}</code>)
      </span>
      <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
        <div>
          <span style={{ color: "#137333", fontWeight: 600 }}>new:</span>{" "}
          {conflict.newStatement}
        </div>
        <div>
          <span style={{ color: "#b06000", fontWeight: 600 }}>existing:</span>{" "}
          {conflict.existingStatement}
        </div>
        <div style={{ color: "#777", fontStyle: "italic" }}>
          {conflict.explanation}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          marginTop: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        {OPTIONS.map((o) => {
          const active = choice === o.value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={busy}
              title={o.hint}
              onClick={() => void choose(o.value)}
              style={{
                font: "inherit",
                fontSize: "0.8rem",
                fontWeight: 600,
                padding: "0.25rem 0.7rem",
                borderRadius: 6,
                border: `1px solid ${o.tone}`,
                background: active ? o.tone : "transparent",
                color: active ? "#fff" : o.tone,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {o.label}
            </button>
          );
        })}
        {choice && (
          <span
            style={{ alignSelf: "center", fontSize: "0.78rem", color: "#777" }}
          >
            resolved: {choice}
          </span>
        )}
      </div>
    </div>
  );
}
