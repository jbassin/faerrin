import { useState } from "react";
import { togglePromotion, type SessionView } from "@/server/sessions";
import type { ReviewState } from "@faerrin/heartwood/src/state/review.ts";
import { CitationChip } from "./CitationChip.tsx";

type Triage = SessionView["artifact"]["triage"];
type Claim = Triage["canon"][number];

// AC-1: pre-sorted Canon / Uncertain / Noise, noise collapsed with a count.
// AC-14: a fact buried in Uncertain/Noise can be promoted to Canon in one action — recorded
// in review state so it is never silently lost (the reviewer then authors/commits it).
export function TriageView({
  arc,
  date,
  triage,
  review,
  onChanged,
}: {
  arc: string;
  date: string;
  triage: Triage;
  review: ReviewState;
  onChanged: (state: ReviewState) => void;
}) {
  const promoted = new Set(review.promotedClaims);
  return (
    <div>
      <Bucket title="Canon" tone="#137333" claims={triage.canon} />
      <Bucket
        title="Uncertain"
        tone="#b06000"
        claims={triage.uncertain}
        arc={arc}
        date={date}
        promoted={promoted}
        onChanged={onChanged}
      />
      <Bucket
        title="Noise"
        tone="#777"
        claims={triage.noise}
        collapsed
        arc={arc}
        date={date}
        promoted={promoted}
        onChanged={onChanged}
      />
    </div>
  );
}

function Bucket({
  title,
  tone,
  claims,
  collapsed,
  arc,
  date,
  promoted,
  onChanged,
}: {
  title: string;
  tone: string;
  claims: Claim[];
  collapsed?: boolean;
  arc?: string;
  date?: string;
  promoted?: Set<string>;
  onChanged?: (state: ReviewState) => void;
}) {
  const [open, setOpen] = useState(!collapsed);
  const [busy, setBusy] = useState<string | null>(null);
  const canPromote = Boolean(arc && date && promoted && onChanged);

  async function promote(claimId: string) {
    setBusy(claimId);
    try {
      onChanged!(
        await togglePromotion({ data: { arc: arc!, date: date!, claimId } }),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={{ marginBottom: "1rem" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          font: "inherit",
          fontWeight: 600,
          color: tone,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? "▾" : "▸"} {title} ({claims.length})
      </button>
      {open && (
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
          {claims.map((c) => {
            const isPromoted = promoted?.has(c.id);
            return (
              <li key={c.id} style={{ marginBottom: "0.3rem" }}>
                {c.text}{" "}
                {c.citations.map((cit, i) => (
                  <CitationChip key={i} citation={cit} />
                ))}
                {c.modality !== "gm-stated" && (
                  <em style={{ color: "#b06000", fontSize: "0.78rem" }}>
                    {" "}
                    [{c.modality}]
                  </em>
                )}
                {canPromote &&
                  (isPromoted ? (
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => void promote(c.id)}
                      style={promotedBtn}
                    >
                      ✓ promoted (undo)
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === c.id}
                      onClick={() => void promote(c.id)}
                      style={promoteBtn}
                    >
                      promote to canon
                    </button>
                  ))}
              </li>
            );
          })}
          {claims.length === 0 && <li style={{ color: "#999" }}>none</li>}
        </ul>
      )}
    </section>
  );
}

const promoteBtn: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.72rem",
  marginLeft: "0.4rem",
  color: "#137333",
  background: "transparent",
  border: "1px solid #137333",
  borderRadius: 4,
  padding: "0 0.3rem",
  cursor: "pointer",
};
const promotedBtn: React.CSSProperties = {
  ...promoteBtn,
  background: "#137333",
  color: "#fff",
};
