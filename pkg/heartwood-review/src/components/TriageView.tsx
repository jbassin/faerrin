import { useState } from "react";
import type { SessionView } from "@/server/sessions";
import { CitationChip } from "./CitationChip.tsx";

type Triage = SessionView["artifact"]["triage"];
type Claim = Triage["canon"][number];

// AC-1: pre-sorted Canon / Uncertain / Noise, noise collapsed with a count. (Promote/
// discard that re-feeds assembly is a Phase-3 refinement; this is the read surface so
// the reviewer can confirm the split and spot a fact buried in banter — AC-14.)
export function TriageView({ triage }: { triage: Triage }) {
  return (
    <div>
      <Bucket title="Canon" tone="#137333" claims={triage.canon} />
      <Bucket title="Uncertain" tone="#b06000" claims={triage.uncertain} />
      <Bucket title="Noise" tone="#777" claims={triage.noise} collapsed />
    </div>
  );
}

function Bucket({
  title,
  tone,
  claims,
  collapsed,
}: {
  title: string;
  tone: string;
  claims: Claim[];
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
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
          {claims.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.3rem" }}>
              {c.text}{" "}
              {c.citations.map((cit, i) => (
                <CitationChip key={i} citation={cit} />
              ))}
              {c.modality !== "gm-stated" && (
                <em style={{ color: "#b06000", fontSize: "0.78rem" }}> [{c.modality}]</em>
              )}
            </li>
          ))}
          {claims.length === 0 && <li style={{ color: "#999" }}>none</li>}
        </ul>
      )}
    </section>
  );
}
