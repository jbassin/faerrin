import { useState } from "react";
import { getTranscriptLines, type TranscriptLine } from "@/server/sessions";

interface Citation {
  transcript: string;
  start: number;
  end: number;
}

// AC-3: hover/click a citation to see the backing transcript lines, fetched locally
// (no LLM). Lazy-loads on first open and caches.
export function CitationChip({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (lines || error) return;
    try {
      const got = await getTranscriptLines({
        data: { transcript: citation.transcript, start: citation.start, end: citation.end },
      });
      setLines(got);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load lines");
    }
  }

  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => {
        setOpen(true);
        void load();
      }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
        style={{
          font: "inherit",
          fontSize: "0.75rem",
          color: "#2b6cb0",
          background: "rgba(43,108,176,0.08)",
          border: "1px solid rgba(43,108,176,0.25)",
          borderRadius: 4,
          padding: "0 0.35rem",
          cursor: "pointer",
        }}
        aria-label={`transcript lines ${citation.start}-${citation.end}`}
      >
        L{citation.start}-{citation.end}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: "1.4rem",
            left: 0,
            width: 380,
            maxHeight: 260,
            overflow: "auto",
            background: "#fff",
            color: "#1c1c1e",
            border: "1px solid #ccc",
            borderRadius: 6,
            boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            padding: "0.6rem 0.75rem",
            fontSize: "0.85rem",
          }}
        >
          <div style={{ color: "#888", fontSize: "0.72rem", marginBottom: "0.4rem" }}>
            {citation.transcript}
          </div>
          {error && <div style={{ color: "#c0392b" }}>{error}</div>}
          {!error && !lines && <div style={{ color: "#888" }}>loading…</div>}
          {lines && lines.length === 0 && (
            <div style={{ color: "#888" }}>No lines in range.</div>
          )}
          {lines?.map((l) => (
            <div key={l.id} style={{ marginBottom: "0.3rem" }}>
              <span style={{ color: "#999", fontVariantNumeric: "tabular-nums" }}>
                {String(l.id).padStart(6, "0")}{" "}
              </span>
              <strong>{l.speaker}:</strong> {l.text}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
