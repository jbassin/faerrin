import { useEffect, useState } from "react";
import { getPageParagraphs, type PageParagraph } from "@/server/sessions";
import type {
  WeaveTarget,
  WeaveMode,
} from "@faerrin/heartwood/src/state/review.ts";

// AC-12: choose where approved amend prose is woven — at the end (default), into a chosen
// paragraph (one continuous paragraph), or as a new paragraph after one. The Reading view
// renders the result in place so the seam/rhythm can be judged.
export function WeavePicker({
  targetPath,
  initial,
  onChange,
}: {
  targetPath: string;
  initial: WeaveTarget | undefined;
  onChange: (weave: WeaveTarget) => void;
}) {
  const [mode, setMode] = useState<WeaveMode>(initial?.mode ?? "end");
  const [anchorText, setAnchorText] = useState<string>(
    initial?.anchorText ?? "",
  );
  const [paras, setParas] = useState<PageParagraph[] | null>(null);

  useEffect(() => {
    if (mode === "end" || paras) return;
    void getPageParagraphs({ data: { path: targetPath } }).then((p) => {
      setParas(p);
      if (!anchorText && p[0]) setAnchorText(p[0].text);
    });
  }, [mode, targetPath, paras, anchorText]);

  useEffect(() => {
    onChange(mode === "end" ? { mode } : { mode, anchorText });
  }, [mode, anchorText, onChange]);

  return (
    <div
      style={{
        marginBottom: "0.5rem",
        fontSize: "0.85rem",
        display: "flex",
        gap: "0.4rem",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <span style={{ color: "#555" }}>Weave:</span>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as WeaveMode)}
        style={{
          font: "inherit",
          fontSize: "0.85rem",
          padding: "0.25rem",
          borderRadius: 6,
          border: "1px solid #ccc",
        }}
      >
        <option value="end">append at end</option>
        <option value="into">into a paragraph…</option>
        <option value="after">new paragraph after…</option>
      </select>
      {mode !== "end" && (
        <select
          value={anchorText}
          onChange={(e) => setAnchorText(e.target.value)}
          style={{
            font: "inherit",
            fontSize: "0.85rem",
            padding: "0.25rem",
            borderRadius: 6,
            border: "1px solid #ccc",
            flex: 1,
            minWidth: 220,
          }}
        >
          {!paras && <option>loading paragraphs…</option>}
          {paras?.length === 0 && (
            <option value="">(no prose paragraphs)</option>
          )}
          {paras?.map((p, i) => (
            <option key={i} value={p.text}>
              {p.preview}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
