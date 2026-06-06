import { useState } from "react";
import { saveConflictResolution, type SessionView } from "@/server/sessions";
import type {
  ConflictResolution,
  ReviewState,
} from "@faerrin/heartwood/src/state/review.ts";

type Conflict = SessionView["artifact"]["conflicts"][number];

// AC-11: surface a cross-arc canon conflict with both statements + source, and offer
// Supersede / Coexist / Reject (never auto-resolved). The choice is persisted by the
// conflicting claimId; its mechanical effect (Supersede → a correction of the existing
// sentence, AC-21) is applied when authoring/committing — the human stays the gate.
const OPTIONS: { value: ConflictResolution; label: string; hint: string }[] = [
  {
    value: "supersede",
    label: "Supersede",
    hint: "the new fact replaces the existing one (a retcon/correction)",
  },
  {
    value: "coexist",
    label: "Coexist",
    hint: "both are true — keep them side by side",
  },
  {
    value: "reject",
    label: "Reject",
    hint: "drop the new fact; the page stays as is",
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
                border: "1px solid #b06000",
                background: active ? "#b06000" : "transparent",
                color: active ? "#fff" : "#b06000",
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
